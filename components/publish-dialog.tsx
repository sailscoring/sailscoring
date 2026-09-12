'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ValidationApiError } from '@/lib/api-client';
import {
  getPublication,
  publishSeries,
  retractPublishedPage,
  unpublishSeries,
} from '@/lib/api-repository';
import { defaultPageSlug, fleetSubPath, kebab } from '@/lib/publishing';
import { sharedFolderSegment } from '@/lib/published-tree';
import {
  describeGroupMembers,
  describeGroupSections,
  resolvePublishingGroups,
} from '@/lib/publishing-groups';
import {
  isExtraPage,
  resolvePublishPages,
  PRIZES_PAGE,
  type PublishPage,
} from '@/lib/publish-pages';
import { Pencil, StickyNote } from 'lucide-react';
import {
  describePageNoteKey,
  orphanedPageNotes,
  pageNoteFor,
  pageNoteKey,
  withPageNote,
  type NotePageRef,
} from '@/lib/page-note';
import { PageNoteEditor } from '@/components/page-note-editor';
import { useSubSeriesBySeries } from '@/hooks/use-sub-series';
import { useSplitFleetState } from '@/hooks/use-split-fleets';
import { useUpdateSeries, useUpdateSeriesPublishPrefs } from '@/hooks/use-series';
import { useConfirm } from '@/components/confirm-dialog';
import { useFeatures } from '@/components/features-provider';
import { FtpPublishPane } from '@/components/ftp-publish-pane';
import type { Fleet, PublicationStatus, Series } from '@/lib/types';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

/** A race a fleet cannot score yet, as the page that holds it needs to say:
 *  the fleet it belongs to and the race's own label. Passed in by the
 *  standings page, which has already scored the series to draw its tables —
 *  the dialog would otherwise have to score it a second time to find out. */
export interface UnscoredRaceNote {
  fleetId: string;
  fleetName: string;
  raceLabel: string;
}

export interface PublishDialogProps {
  series: Series;
  fleets: Fleet[];
  open: boolean;
  onClose: () => void;
  /** Whether FTP upload is available (feature-gated + manage-workspace). When
   *  true the dialog offers a persistent switch to the FTP destination. */
  canFtp: boolean;
  /** Races waiting for a course. Pages carrying the fleets these belong to are
   *  refused by the server, so the dialog marks them before Publish is pressed
   *  rather than letting the refusal be the first news of it. */
  unscored?: UnscoredRaceNote[];
}

/** Sanitise free-typed slug / sub-path input to the allowed character set. */
function sanitizeSlug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/** Last path segment of a public fleet URL — the part under the shared slug. */
function lastSegment(url: string): string {
  return url.split('/').filter(Boolean).pop() ?? '';
}

/** A published page's path under the slug — everything after `/p/{ws}/{slug}/`.
 *  This is the sub-path the server froze; a sub-series page carries two
 *  segments, every other page one. */
function subPathOf(url: string): string {
  return new URL(url).pathname.split('/').filter(Boolean).slice(3).join('/');
}

/** Join names as `A`, `A and B`, or `A, B and C` for prose. */
function formatNameList(names: string[]): string {
  if (names.length === 0) return 'another series';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** One page row's state in the dialog — a fleet, or a combined page (its
 *  name-keyed publishing group). A page already published is *frozen*: its
 *  sub-path is fixed (like the slug) and shown read-only. A not-yet-published
 *  page is editable, seeded with the derived default sub-path. */
interface FleetRow {
  name: string;
  frozen: boolean;
  /** Frozen pages only: the live page URL, for the link + Copy. */
  publishedUrl: string | null;
  /** Combined pages only: membership + detail summary, e.g.
   *  `all fleets · standings only`. */
  caption?: string;
}

/** A fleet listed while individual fleet pages are switched off — shown so
 *  nothing reads as vanished, but not selectable or path-editable. */
interface SuppressedRow {
  name: string;
  /** Combined page(s) the fleet appears on; empty = on none (not published). */
  groupNames: string[];
}

/**
 * In-app results publishing (ADR-008 Phase 9/10, the bilge replacement — #153).
 * Publish is explicit and point-in-time. The slug is editable at first publish
 * and frozen after; the dialog shows the resulting public URL(s) as you edit it.
 *
 * Per fleet, the scorer can: choose whether to publish/update it now (untick a
 * work-in-progress fleet to skip it — an already-published one keeps its current
 * live page; Unpublish is what retracts pages), and edit its URL sub-path while
 * it's unpublished (a published fleet's sub-path is frozen). This lets a clean
 * fleet name ("Puppeteers HPH") point at a disambiguated URL segment
 * ("tuesday-puppeteers-hph") when several series share one slug.
 */
export function PublishDialog({ series, fleets, open, onClose, canFtp, unscored = [] }: PublishDialogProps) {
  const updateSeries = useUpdateSeries();
  const updatePublishPrefs = useUpdateSeriesPublishPrefs();
  const confirm = useConfirm();
  const { has } = useFeatures();
  // Destination mode. Persisted per-series (`series.publishMode`) so the dialog
  // reopens where the scorer left it; clamped to Sail Scoring when FTP isn't
  // available so a workspace that loses the feature isn't stranded in FTP mode.
  const [mode, setMode] = useState<'sailscoring' | 'ftp'>('sailscoring');
  // Sub-series publish one page per (block, fleet) with server-derived
  // `{block}/{leaf}` paths, so the per-fleet URL editors don't apply.
  const { data: subSeriesList } = useSubSeriesBySeries(series.id);
  const hasBlocks = (subSeriesList?.length ?? 0) > 0;
  // A championship publishes its own pages rather than its round fleets' —
  // the same condition the build applies, a committed round rather than a
  // configured format. Asked for only where it can exist: a workspace
  // without the gate has no championship.
  const { data: splitState } = useSplitFleetState(series.id, {
    enabled: has('split-fleets'),
  });
  const isChampionship = (splitState?.rounds?.length ?? 0) > 0;
  // What this series publishes — the one derivation, shared with the build
  // and with the FTP pane below, so a destination can never offer a set of
  // pages the other doesn't. Combined pages (#255, #390) are defined on the
  // Settings tab and *reflected* here; the prize sheet (#240) and the entry
  // list (#423) arrive with their workspace features.
  const pages = resolvePublishPages({
    series,
    fleets,
    splitFleets: isChampionship,
    features: { prizes: has('prizes'), entryList: has('entry-list') },
  });
  // The lone default page, when there is one: a single-fleet series' results,
  // or a championship's standings. Its name can be synthetic ("Default",
  // "Unknown"), which is why the server takes it by flag rather than by name
  // — and why the dialog labels it generically unless the page names itself.
  const defaultPage = pages.find((p) => p.isDefault) ?? null;
  // The pages that carry a name the scorer would recognise, each with its own
  // row: everything except that lone page.
  const namedPages = pages.filter((p) => !p.isDefault);
  const pageNames = namedPages.map((p) => p.name);
  // The pages that are not a fleet's results: the prize sheet, the entry
  // list, and a championship's race-results and assignments pages. They ride
  // the publish machinery like any other page, but none of them counts when
  // asking whether a publication has results — or which live page the lone
  // results row should preview.
  const extraPageSet = new Set(pages.filter(isExtraPage).map((p) => p.name));
  // Combined-page detail, for the row captions — the group behind each page.
  const resolvedGroups = resolvePublishingGroups(series.publishingGroups, fleets);
  const [status, setStatus] = useState<PublicationStatus | null>(null);
  const [slug, setSlug] = useState('');
  // Where a first publish lands (ADR-011): a season folder — "Season: 2026,
  // Folder: spring-regatta". The season derives from the series' start date
  // (the current year for an undated series); there is no custom-slug shape,
  // only the tree.
  const [season, setSeason] = useState('');
  const [folder, setFolder] = useState('');
  // Selected fleet names (the set to publish) and per-fleet editable sub-paths.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subPaths, setSubPaths] = useState<Record<string, string>>({});
  // The lone default page's editable sub-path (single-fleet series). Kept
  // separate from `subPaths` because that page's fleet name can be synthetic
  // ("Unknown") and isn't a reliable key; the server applies it by `isDefault`.
  const [singlePath, setSinglePath] = useState('standings');
  // Whether the lone default page publishes this round. Its own state because
  // it is not in `pageNames` — the dialog often cannot name it (its fleet may
  // be the synthetic "Default"/"Unknown"), which is why the server skips it by
  // flag rather than by name.
  const [loneSelected, setLoneSelected] = useState(true);
  // The scorer's explicit "publish the races that are scored" — off every time
  // the dialog opens, because it is a decision about the state of the results
  // in front of them now, not a setting.
  const [allowUnscored, setAllowUnscored] = useState(false);
  const [phase, setPhase] = useState<
    'loading' | 'idle' | 'publishing' | 'unpublishing' | 'retracting'
  >('loading');
  const [error, setError] = useState<string | null>(null);
  // Which note is open in the editor, by note key — `SERIES_NOTE` for the one
  // that goes on every page. Writing a note here is a series edit like any
  // other, so the "N edits since" line above lights up the moment it is
  // saved, which is exactly the prompt to re-publish.
  const [openNote, setOpenNote] = useState<string | null>(null);

  const published = status?.published ?? null;
  const isPublished = published !== null;
  const workspaceSlug = status?.workspaceSlug ?? '';

  // A single-race event's lone page is its race result (#347), so it is named
  // and served as one. A championship's lone page is its standings whatever
  // the setting says — the setting has no say over a tiered table.
  const raceResults = series.publishDetail === 'races' && !isChampionship;
  // What the lone page is called. A page that names itself ("Championship")
  // says so; a fleet's page is labelled generically, because the fleet behind
  // it is often the synthetic "Default" the series was created with.
  const lonePageLabel =
    defaultPage && defaultPage.kind !== 'fleet'
      ? defaultPage.name
      : raceResults
        ? 'Results'
        : 'Standings';

  // Derived default sub-path for an unpublished page: `standings` (or
  // `results`) for the lone default page, `prizes` / `entries` for those two
  // regardless of the fleet count (when co-publishing the server
  // disambiguates to `{series-slug}-prizes`), otherwise the kebab-cased name
  // — mirroring the server. Every other page is served at its own name, the
  // lone page's slug being the lone page's.
  const defaultSubPathFor = (page: PublishPage): string =>
    page.kind === 'prizes'
      ? 'prizes'
      : page.kind === 'entries'
        ? 'entries'
        : page.isDefault
          ? defaultPageSlug(raceResults)
          : fleetSubPath(page.name, false);
  const pageByName = new Map(pages.map((p) => [p.name, p]));
  const defaultSubPath = (name: string): string => {
    const page = pageByName.get(name);
    return page ? defaultSubPathFor(page) : fleetSubPath(name, false);
  };

  // Load publication state each time the dialog opens, and seed the per-fleet
  // selection + sub-paths from it. Syncing with the external open signal, so the
  // state writes here are expected.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase('loading');
    setError(null);
    setAllowUnscored(false);
    getPublication(series.id)
      .then((s) => {
        if (cancelled) return;
        const pub = s.published;
        const publishedByName = new Map(
          (pub?.pages ?? []).map((p) => [p.fleetName, p.url]),
        );
        const initSelected = new Set<string>();
        const initSubPaths: Record<string, string> = {};
        for (const name of pageNames) {
          const isPub = publishedByName.has(name);
          // First publish: everything ticked. Re-publish: only what's already
          // live, so re-publishing never silently adds a newly-created page.
          if (!pub || isPub) initSelected.add(name);
          // Editable sub-path only for not-yet-published pages.
          if (!isPub) initSubPaths[name] = defaultSubPath(name);
        }
        setStatus(s);
        setSlug(pub?.slug ?? s.suggestedSlug);
        setSeason(s.suggestedSeason);
        setFolder(s.suggestedSlug);
        setSelected(initSelected);
        setSubPaths(initSubPaths);
        setSinglePath('standings');
        // Same rule as the named pages: everything on a first publish, only
        // what is already live on a re-publish, so re-publishing never
        // silently puts out a page the scorer had left back.
        setLoneSelected(
          !pub || (pub.pages ?? []).some((pg) => !extraPageSet.has(pg.fleetName)),
        );
        setPhase('idle');
      })
      .catch(() => {
        if (!cancelled) setPhase('idle');
      });
    return () => {
      cancelled = true;
    };
    // Seeds once per open per series; `fleets`/`defaultSubPath` are stable for a
    // given series, and listing them would re-seed (wiping edits) on every
    // parent re-render that hands us a fresh array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, series.id]);

  // Seed the destination mode from the series each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const stored = series.publishMode ?? 'sailscoring';
    setMode(stored === 'ftp' && canFtp ? 'ftp' : 'sailscoring');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Flip destination and persist the choice so it sticks for next time. Fire
  // and forget — a preference write shouldn't block the UI, and a failure just
  // means the dialog reopens in the previous mode.
  //
  // Through the publish-prefs write, not a series save: opening a dialog on a
  // different tab is not an edit to the series, and filing it as one told the
  // scorer they had changed a setting and left the publish indicators
  // counting an edit that never happened.
  function switchMode(next: 'sailscoring' | 'ftp') {
    if (next === mode || (next === 'ftp' && !canFtp)) return;
    setMode(next);
    updatePublishPrefs.mutate({ id: series.id, prefs: { publishMode: next } });
  }

  /** What each non-fleet page is, for the row's caption — shared by the
   *  multi-fleet row list and the extra-page rows of a single-fleet series. */
  const captionByName = (() => {
    const captions = new Map(
      resolvedGroups.map((r) => [
        r.group.name.trim(),
        r.group.sectionAxisId != null
          ? `${describeGroupSections(r.group, series.subdivisionAxes ?? [])} · standings only`
          : `${describeGroupMembers(r)} · ${r.group.detail === 'standings' ? 'standings only' : 'full detail'}`,
      ]),
    );
    if (pages.some((p) => p.kind === 'prizes')) {
      const prizeCount = series.prizes?.length ?? 0;
      captions.set('Prizes', `prize list · ${prizeCount} prize${prizeCount === 1 ? '' : 's'}`);
    }
    return captions;
  })();

  /** The unscored races each page would carry, by page name. A fleet page
   *  answers for its own fleet, a combined page for the fleets it carries, and
   *  the prize sheet for every fleet — the same reach the server refuses on,
   *  so what the dialog marks and what the server holds are the same set. */
  const unscoredByPage = (() => {
    const byPage = new Map<string, UnscoredRaceNote[]>();
    if (unscored.length === 0) return byPage;
    const fleetsOfGroup = new Map(resolvedGroups.map((r) => [r.group.id, r.fleets.map((f) => f.id)]));
    for (const page of pages) {
      const ids =
        page.kind === 'fleet' ? (page.fleetId ? [page.fleetId] : [])
        : page.kind === 'combined' ? (fleetsOfGroup.get(page.groupId ?? '') ?? [])
        : page.kind === 'prizes' ? fleets.map((f) => f.id)
        : [];
      if (ids.length === 0) continue;
      const held = unscored.filter((u) => ids.includes(u.fleetId));
      if (held.length > 0) byPage.set(page.name, held);
    }
    return byPage;
  })();
  /** The unscored races held by the pages going out this round — what the
   *  dialog has to say something about, and nothing more: a gap on a page the
   *  scorer left unticked is not holding this publish up. The lone default
   *  page of a single-fleet series is not in `pageNames`, so it is asked about
   *  through its own selection flag, exactly as the publish call reports it. */
  const heldNow = [
    ...new Set(
      [...unscoredByPage]
        .filter(([name]) => (pageNames.includes(name) ? selected.has(name) : loneSelected))
        .flatMap(([, held]) => held),
    ),
  ];
  const heldSelected = heldNow.length > 0;

  const rows: FleetRow[] = (() => {
    const publishedByName = new Map(
      (published?.pages ?? []).map((p) => [p.fleetName, p.url]),
    );
    return pageNames.map((name) => ({
      name,
      frozen: publishedByName.has(name),
      publishedUrl: publishedByName.get(name) ?? null,
      ...(captionByName.has(name) ? { caption: captionByName.get(name)! } : {}),
    }));
  })();

  // Fleets while individual pages are off: listed dimmed so the scorer sees
  // where each fleet went — its combined page(s), or a warning when no
  // combined page covers it (it isn't published at all).
  const suppressedRows: SuppressedRow[] = (() => {
    // A championship's round fleets are internal — they are not fleets whose
    // page went missing, so they are not listed as such.
    if (isChampionship) return [];
    const published = new Set(
      pages.filter((p) => p.kind === 'fleet').map((p) => p.fleetId),
    );
    const combinedIds = new Set(pages.filter((p) => p.kind === 'combined').map((p) => p.groupId));
    return fleets
      .filter((f) => !published.has(f.id))
      .map((f) => ({
        name: f.name,
        groupNames: resolvedGroups
          .filter((r) => combinedIds.has(r.group.id) && r.fleets.some((m) => m.id === f.id))
          .map((r) => r.group.name.trim()),
      }));
  })();

  // The sub-path each row resolves to (frozen path, or the editable value).
  const segmentFor = (row: FleetRow): string =>
    row.frozen ? lastSegment(row.publishedUrl ?? '') : (subPaths[row.name] ?? '');

  // The slug a first publish will use: the season's URL form, with pages
  // under the event folder — except a block series, whose `{block}/{page}`
  // pages already use both path segments: its folder becomes its own
  // top-level slug, filed under the season via the folder's season pin.
  // Frozen once published.
  const seasonMode = !isPublished;
  const effectiveSlug = isPublished ? slug : hasBlocks ? folder.trim() : kebab(season);
  // The folder prefix pages land under. Before first publish it's the Folder
  // field; once published it derives from the frozen page URLs, so the
  // preview names the folder and a later-added page lands inside it.
  // Sub-series pages already use their block segment, so a block series
  // publishes its `{block}/{fleet}` pages directly under its slug.
  const publishedFolder = useMemo(() => {
    if (!published) return null;
    return sharedFolderSegment(published.pages.map((p) => subPathOf(p.url)));
  }, [published]);
  const folderPrefix = hasBlocks
    ? ''
    : isPublished
      ? (publishedFolder ?? '')
      : folder.trim();
  const urlPrefix = `${APP_URL}/p/${workspaceSlug}/${effectiveSlug || '…'}`;
  const pagesPrefix = `${urlPrefix}${folderPrefix ? `/${folderPrefix}` : ''}`;

  // A single-fleet series has one default page. Its sub-path is editable before
  // first publish (seeded `standings`) and frozen after — the same lifecycle as a
  // multi-fleet row, just without the per-fleet selection. Sending it explicitly
  // keeps the URL WYSIWYG: the server no longer silently renames it to the series
  // slug when the page co-publishes into a shared slug.
  const multiFleet = defaultPage === null;

  // The publication's live results pages when there are several in single-page
  // mode (a championship's standings + race-results + assignments); null means
  // one page and the `singlePreview` link renders alone. Blocks link their
  // index instead, and the prizes page keeps its dedicated row.
  const publishedResultPages = (() => {
    if (hasBlocks) return null;
    const live = (published?.pages ?? []).filter((p) => !extraPageSet.has(p.fleetName));
    return live.length > 1 ? live : null;
  })();

  // The single default page once published — the server's actual live page, used
  // for the frozen read-only link + Copy.
  const singlePreview = (() => {
    // The prize sheet and the competitor list have their own rows below — the
    // preview is the results page. A publication that is *only* those (an
    // entry list published before race one) has no results page to preview,
    // and the lone row is left out rather than repeating a row below it.
    const page = published?.pages.find((p) => !extraPageSet.has(p.fleetName));
    if (published && !page) return null;
    return {
      fleetName: page?.fleetName ?? fleets[0]?.name ?? 'Standings',
      // With sub-series there are several pages; link the series index that
      // lists them all rather than one block's page. In season mode the lone
      // page lives at the folder itself.
      url: hasBlocks
        ? urlPrefix
        : (page?.url ??
          `${urlPrefix}/${folderPrefix ? `${folderPrefix}/` : ''}${singlePath || 'standings'}`),
    };
  })();


  // Client-side guard so the button reflects what the server would reject. The
  // single default page needs a non-empty sub-path while it's still editable
  // (unpublished); once published its path is frozen and always valid. For the
  // multi-fleet UI, the pages that will be live afterwards are the ticked ones
  // plus any already-published fleet (which stays live even when unticked) — we
  // need at least one, with distinct sub-paths.
  const prizesFrozen = (published?.pages ?? []).some((p) => p.fleetName === PRIZES_PAGE);

  /** Whether a page of this name is already live (its URL frozen). */
  const frozenPage = (name: string) =>
    (published?.pages ?? []).some((p) => p.fleetName === name);

  // Pages listed beneath the lone results page of a single-fleet series: the
  // extra pages defined for it (#390) and the prize sheet. A multi-fleet
  // series lists all of these as ordinary rows above instead.
  const extraPageNames = multiFleet ? [] : pageNames;

  const validation = useMemo(() => {
    if (seasonMode) {
      if (!season) return 'Choose a season.';
      if (!folder.trim()) return 'Give the event a folder.';
    }
    if (!multiFleet) {
      // The prize sheet and any axis-sectioned page make even a single-fleet
      // series multi-page: each needs an (editable) sub-path of its own,
      // present and distinct from the results page and from each other.
      const ticked = extraPageNames.filter(
        (name) => selected.has(name) && !frozenPage(name),
      );
      for (const name of ticked) {
        if (!(subPaths[name] ?? '')) {
          return name === PRIZES_PAGE ? 'Give the prize list a URL.' : `Give “${name}” a URL.`;
        }
      }
      // Something has to go out. A page already live counts: leaving it
      // unticked keeps it up rather than taking it down.
      const liveAfter =
        (loneSelected || (isPublished && singlePreview !== null)) ||
        extraPageNames.some((name) => selected.has(name) || frozenPage(name));
      if (!liveAfter) return 'Select at least one page to publish.';
      if (isPublished || hasBlocks) return null;
      if (!loneSelected) return null;
      if (!singlePath) return 'Give the page a URL.';
      const seenExtra = new Set([singlePath]);
      for (const name of ticked) {
        const seg = subPaths[name];
        if (seenExtra.has(seg)) {
          return name === PRIZES_PAGE && seg === singlePath
            ? 'The prize list and the results page share a URL. Make them unique.'
            : `Two pages share the URL “${seg}”. Make them unique.`;
        }
        seenExtra.add(seg);
      }
      return null;
    }
    const live = rows.filter((r) => r.frozen || selected.has(r.name));
    if (live.length === 0) return 'Select at least one fleet to publish.';
    if (hasBlocks) return null; // paths are server-derived per block
    const seen = new Set<string>();
    for (const r of live) {
      const seg = segmentFor(r);
      if (!seg) return `Give “${r.name}” a URL.`;
      if (seen.has(seg)) return `Two fleets share the URL “${seg}”. Make them unique.`;
      seen.add(seg);
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiFleet, isPublished, hasBlocks, singlePath, rows, selected, subPaths, published, seasonMode, season, folder, loneSelected, extraPageNames, singlePreview]);

  const pendingEdits = published
    ? Math.max(0, (series.version ?? 1) - published.publishedVersion)
    : 0;

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.name));

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.name)));
  }

  // ---- Notes (#511) ----
  //
  // A block series is left out: this dialog lists one row per fleet across
  // every sub-series ("one page per sub-series"), so no row here names the
  // page a note would land on. Preview enumerates them, and is where a block
  // series' notes are written.
  const canNote = has('page-notes') && !hasBlocks;
  const SERIES_NOTE = '@every-page';

  function saveNote(page: NotePageRef | null, text: string) {
    updateSeries.mutate({
      id: series.id,
      patch:
        page === null
          ? () => ({ seriesNote: text })
          : (s) => ({ pageNotes: withPageNote(s.pageNotes, page, text) }),
    });
    setOpenNote(null);
  }

  /** The note affordance on a page's row: filled once the page carries one,
   *  and titled with the note itself, so a note written three days ago is
   *  seen before it goes out again rather than after. */
  function noteButton(page: NotePageRef) {
    if (!canNote) return null;
    const key = pageNoteKey(page);
    const note = pageNoteFor(series.pageNotes, page);
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 shrink-0 p-0"
        aria-label={`Note on ${page.fleetName}`}
        title={note || 'Add a note to this page'}
        data-testid={`page-note-button-${key}`}
        onClick={() => setOpenNote(openNote === key ? null : key)}
      >
        <StickyNote
          className={`h-4 w-4 ${note ? 'fill-amber-200 text-amber-700 dark:fill-amber-900 dark:text-amber-400' : 'text-muted-foreground'}`}
        />
      </Button>
    );
  }

  /** The editor, opened beneath the row it belongs to — rather than in a
   *  window over the dialog, which would put a second modal between the
   *  scorer and the page list they are working down. */
  function noteEditor(page: NotePageRef, label: string) {
    const key = pageNoteKey(page);
    if (!canNote || openNote !== key) return null;
    const entry = (series.pageNotes ?? []).find((n) => n.page === key);
    return (
      <PageNoteEditor
        value={pageNoteFor(series.pageNotes, page)}
        label={label}
        {...(entry ? { updatedAt: entry.updatedAt } : {})}
        onSave={(text) => saveNote(page, text)}
        onCancel={() => setOpenNote(null)}
      />
    );
  }

  /** The lone results page's note identity — keyed by `isDefault`, since its
   *  fleet name here may be the synthetic "Default" or "Unknown". */
  const lonePageRef: NotePageRef = { fleetName: lonePageLabel, isDefault: true };

  // Notes filed against pages this series no longer builds — a renamed fleet
  // leaves one behind. Kept in the file rather than dropped, and surfaced
  // here once so they can be cleared.
  const orphanNotes = canNote
    ? orphanedPageNotes(series.pageNotes, [
        ...pageNames.map((name) => ({ fleetName: name })),
        ...(multiFleet ? [] : [lonePageRef]),
      ])
    : [];

  async function handlePublish() {
    setPhase('publishing');
    setError(null);
    try {
      // Multi-fleet: send the selection, plus sub-path overrides for the editable
      // (unfrozen) fleets in it. Only send a path the scorer actually changed —
      // leaving the default lets the server derive it. Single-fleet first publish:
      // send the lone page's sub-path explicitly so its URL is exactly what the
      // dialog shows, never the server's silent shared-slug rename. Re-publish
      // sends neither (the path is frozen). The slug is honoured only on first publish.
      // Whether the server needs telling where the lone results page goes:
      // it is going out, and has no frozen path to reuse — a first publish, or
      // a page held back until now.
      const needsDefaultPath =
        !multiFleet && !hasBlocks && loneSelected && (!isPublished || singlePreview === null);
      let selection: {
        fleets?: string[];
        subPaths?: Record<string, string>;
        defaultSubPath?: string;
        defaultPage?: boolean;
      } = {};
      if (multiFleet) {
        const fleetNames = rows.filter((r) => selected.has(r.name)).map((r) => r.name);
        const overrides: Record<string, string> = {};
        if (!hasBlocks) {
          for (const r of rows) {
            if (r.frozen || !selected.has(r.name)) continue;
            const seg = segmentFor(r);
            if (seg !== defaultSubPath(r.name)) overrides[r.name] = seg;
          }
        }
        selection = { fleets: fleetNames, subPaths: overrides };
      } else if (extraPageNames.length > 0) {
        // A prize sheet or an axis-sectioned page makes a single-fleet series
        // multi-page. The lone fleet page's name can be synthetic and unknown
        // here, so it can't go
        // in `fleets` — name what to leave out instead (`prizes: false` for the
        // prize sheet, `skipPages` for the rest), and pass each extra page's
        // sub-path override when edited.
        const overrides: Record<string, string> = {};
        const skipPages: string[] = [];
        for (const name of extraPageNames) {
          if (!selected.has(name)) {
            skipPages.push(name);
            continue;
          }
          const seg = subPaths[name] ?? '';
          if (!frozenPage(name) && seg !== defaultSubPath(name)) overrides[name] = seg;
        }
        selection = {
          ...(skipPages.includes(PRIZES_PAGE) ? { prizes: false } : {}),
          ...(skipPages.some((n) => n !== PRIZES_PAGE)
            ? { skipPages: skipPages.filter((n) => n !== PRIZES_PAGE) }
            : {}),
          ...(Object.keys(overrides).length > 0 ? { subPaths: overrides } : {}),
          ...(!isPublished && !hasBlocks ? { defaultSubPath: singlePath } : {}),
        };
      } else if (!isPublished && !hasBlocks) {
        selection = { defaultSubPath: singlePath };
      }
      // Unticking the lone results page leaves it out this round; a live one
      // carries over untouched, exactly as an unticked fleet does.
      if (!multiFleet && !loneSelected) {
        selection = { ...selection, defaultPage: false };
        delete selection.defaultSubPath;
      } else if (needsDefaultPath) {
        // Ticked, but never published: the server has no frozen path to reuse,
        // so say where it goes. (First publish already set this above.)
        selection = { ...selection, defaultSubPath: singlePath };
      }
      // Season mode (ADR-011): pages land under the event folder — every
      // editable page gets an explicit prefixed override, and a lone results
      // page lives at the folder itself.
      if (folderPrefix) {
        if (multiFleet) {
          const overrides: Record<string, string> = {};
          for (const r of rows) {
            if (r.frozen || !selected.has(r.name)) continue;
            overrides[r.name] = `${folderPrefix}/${segmentFor(r)}`;
          }
          selection = { ...selection, subPaths: overrides };
        } else {
          if (needsDefaultPath) {
            // `standings` (or whatever the scorer typed) under the folder.
            selection.defaultSubPath = `${folderPrefix}/${singlePath}`;
          }
          for (const name of extraPageNames) {
            if (!selected.has(name) || frozenPage(name)) continue;
            selection.subPaths = {
              ...(selection.subPaths ?? {}),
              [name]: `${folderPrefix}/${subPaths[name] || defaultSubPath(name)}`,
            };
          }
        }
      }
      const result = await publishSeries(series.id, {
        ...(isPublished
          ? {}
          : {
              slug: effectiveSlug,
              season,
              ...(folderPrefix ? { folder: folderPrefix } : {}),
            }),
        ...selection,
        ...(allowUnscored ? { allowUnscorable: true } : {}),
      });
      // The server freezes the slug it actually used — the season, in season
      // mode — which is not the name-derived suggestion this state was seeded
      // with. Adopt it, or the published preview reads the suggestion back as
      // the top-level segment.
      setSlug(result.slug);
      setStatus((s) => (s ? { ...s, published: result } : s));
      setPhase('idle');
    } catch (e) {
      setPhase('idle');
      if (e instanceof ValidationApiError) {
        const issues = e.issues as
          | {
              code?: string;
              sharedWith?: string[];
              fleetName?: string;
              races?: { fleetName: string; raceNumber: number; raceName?: string; option?: string }[];
            }
          | undefined;
        if (issues?.code === 'unscorable-race') {
          const list = (issues.races ?? []).map(
            (r) =>
              `${r.fleetName} Race ${r.raceNumber}${r.raceName ? ` (${r.raceName})` : ''}${
                r.option === 'CC' ? ' — the start has no course' : ' — the start records no course distance'
              }`,
          );
          setError(
            `Not published: ${formatNameList(list)} cannot be scored under the fleet's ORC option, so nobody in ${
              list.length === 1 ? 'it' : 'them'
            } is scored. Enter the course on the race's start, or change the race's scoring option.`,
          );
          return;
        }
        if (issues?.code === 'slug-shared') {
          // Publishing into a season joins silently; this fires when the
          // top-level URL (a block series' folder, or a season's URL form)
          // collides with an unrelated existing slug.
          setError(
            `That URL is already used by ${formatNameList(issues.sharedWith ?? [])}. Pick a different ${hasBlocks ? 'folder' : 'season label'}.`,
          );
          return;
        }
        if (issues?.code === 'subpath-collision') {
          // Same disambiguation seed for the single default page if it still
          // carries the bare `standings` default that just collided.
          if (!multiFleet && singlePath === 'standings' && status?.suggestedSlug) {
            setSinglePath(status.suggestedSlug);
          }
          setError(
            issues.fleetName
              ? `The URL for “${issues.fleetName}” clashes with another fleet at this slug. Change it, then try again.`
              : 'A fleet URL clashes with another at this slug. Change it, then try again.',
          );
          return;
        }
        if (issues?.code === 'invalid-subpath') {
          setError(
            issues.fleetName
              ? `The URL for “${issues.fleetName}” is invalid — use lowercase letters and numbers, separated by hyphens.`
              : 'A fleet URL is invalid — use lowercase letters and numbers, separated by hyphens.',
          );
          return;
        }
        if (issues?.code === 'no-fleets-selected') {
          setError('Select at least one fleet to publish.');
          return;
        }
        if (issues?.code === 'invalid-slug') {
          setError('Use lowercase letters and numbers, separated by hyphens.');
          return;
        }
      }
      setError(e instanceof Error ? e.message : 'Publish failed.');
    }
  }

  /**
   * Change a live page's URL. The sub-path is frozen for as long as the page is
   * live, so this takes that one page down — the rest of the publication stays
   * up — and hands its old segment back to the editor it has just unfrozen. The
   * page returns, at whatever the scorer types, on the next publish.
   */
  async function handleChangeUrl(
    label: string,
    url: string,
    reseed: (segment: string) => void,
  ) {
    if (!published) return;
    // The only live page is the publication: taking it down frees the slug,
    // withdraws the data file and puts the dialog back to a first publish.
    // That is Unpublish, and it is the next button along.
    const onlyPage = `“${label}” is the only published page, so changing its URL means taking the whole publication down. Use Unpublish, then publish again at the new URL.`;
    if (published.pages.length === 1) {
      setError(onlyPage);
      return;
    }
    const ok = await confirm({
      title: `Change the URL for “${label}”?`,
      description:
        'The page goes offline now and comes back at its new URL when you publish again. Every other page stays live throughout.',
      confirmLabel: 'Take the page down',
      destructive: true,
    });
    if (!ok) return;
    setPhase('retracting');
    setError(null);
    try {
      await retractPublishedPage(series.id, subPathOf(url));
      setStatus((s) =>
        s?.published
          ? {
              ...s,
              published: {
                ...s.published,
                pages: s.published.pages.filter((p) => p.url !== url),
              },
            }
          : s,
      );
      // Seed the now-editable field with the segment the page just had: the
      // scorer is shortening a URL, not composing one from nothing.
      reseed(lastSegment(url));
      setPhase('idle');
    } catch (e) {
      setPhase('idle');
      if (
        e instanceof ValidationApiError &&
        (e.issues as { code?: string } | undefined)?.code === 'last-page'
      ) {
        setError(onlyPage);
        return;
      }
      setError(e instanceof Error ? e.message : 'Taking the page down failed.');
    }
  }

  async function handleUnpublish() {
    const ok = await confirm({
      title: `Unpublish “${series.name}”?`,
      description: 'The public page stops working and its URL frees up.',
      confirmLabel: 'Unpublish',
      destructive: true,
    });
    if (!ok) return;
    setPhase('unpublishing');
    setError(null);
    try {
      await unpublishSeries(series.id);
      // Back to the first-publish state: the slug input returns, pre-filled
      // with the suggestion, and every page ticked again.
      setStatus((s) => (s ? { ...s, published: null } : s));
      setSlug(status?.suggestedSlug ?? '');
      setSelected(new Set(pageNames));
      setSubPaths(
        Object.fromEntries(pageNames.map((name) => [name, defaultSubPath(name)])),
      );
      setSinglePath('standings');
      setPhase('idle');
    } catch (e) {
      setPhase('idle');
      setError(e instanceof Error ? e.message : 'Unpublish failed.');
    }
  }

  const isLoading = phase === 'loading';
  const isPublishing = phase === 'publishing';
  const isUnpublishing = phase === 'unpublishing';
  const isRetracting = phase === 'retracting';

  /** "Change URL" on a live page's row. Offered only where the dialog can
   *  re-path the page once it unfreezes — so not on a sub-series page, whose
   *  path the server derives per block, and not on a championship's several
   *  results pages, whose standings page carries a link to its race results
   *  baked into the rendered HTML. */
  function changeUrlButton(
    label: string,
    url: string,
    reseed: (segment: string) => void,
  ) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-7 w-7 shrink-0 p-0"
        aria-label={`Change URL for ${label}`}
        title="Change this page's URL — it goes offline until you publish again"
        disabled={isPublishing || isUnpublishing || isRetracting}
        onClick={() => handleChangeUrl(label, url, reseed)}
      >
        <Pencil className="h-4 w-4 text-muted-foreground" />
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Publish results</DialogTitle>
          {canFtp && (
            <div
              role="group"
              aria-label="Publish destination"
              className="mt-1 inline-flex self-start rounded-md bg-muted p-0.5 text-sm"
            >
              {(
                [
                  ['sailscoring', 'Sail Scoring pages'],
                  ['ftp', 'Your website (FTP)'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => switchMode(value)}
                  className={`rounded px-3 py-1 font-medium transition-colors ${
                    mode === value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </DialogHeader>

        {mode === 'ftp' ? (
          <FtpPublishPane
            series={series}
            pages={pages}
            lonePageLabel={lonePageLabel}
            onClose={onClose}
          />
        ) : (
        <>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-3 min-w-0">
            {isPublished ? (
              <p className="text-xs text-muted-foreground">
                Last published {new Date(published.publishedAt).toLocaleString()}
                {pendingEdits > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {' · '}
                    {pendingEdits} edit{pendingEdits === 1 ? '' : 's'} since — re-publish to update
                  </span>
                )}
              </p>
            ) : (
              <div className="flex gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="publish-season">Season</Label>
                  <select
                    id="publish-season"
                    value={season}
                    onChange={(e) => { setSeason(e.target.value); setError(null); }}
                    className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    {(status?.seasons ?? []).map((s) => (
                      <option key={s.label} value={s.label}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="publish-folder">Folder</Label>
                  <Input
                    id="publish-folder"
                    value={folder}
                    onChange={(e) => { setFolder(sanitizeSlug(e.target.value)); setError(null); }}
                    placeholder="spring-regatta"
                    autoFocus
                  />
                </div>
              </div>
            )}

            {multiFleet ? (
              <>
                <p className="text-xs text-muted-foreground truncate" title={`${pagesPrefix}/`}>
                  Pages live under{' '}
                  {isPublished ? (
                    // The folder (or slug) index only exists once something's
                    // published, so link it only then.
                    <a
                      href={pagesPrefix}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono hover:underline"
                    >
                      /p/{workspaceSlug}/{slug}/
                      {folderPrefix ? `${folderPrefix}/` : ''}
                    </a>
                  ) : (
                    <span className="font-mono">
                      /p/{workspaceSlug}/{effectiveSlug || '…'}/
                      {folderPrefix ? `${folderPrefix}/` : ''}
                    </span>
                  )}
                </p>
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground pb-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="h-4 w-4 shrink-0"
                    />
                    <span className="flex-1">{resolvedGroups.length > 0 ? 'Page' : 'Fleet'}</span>
                    <span>URL</span>
                  </label>
                  <div className="space-y-1 max-h-[50vh] overflow-y-auto">
                    {rows.map((row) => {
                      const checked = selected.has(row.name);
                      const segment = segmentFor(row);
                      const url = `${urlPrefix}/${segment}`;
                      // Dim only an unpublished fleet that's unticked (truly not
                      // going public). A published fleet stays live even when
                      // unticked — unticking just skips updating it — so it
                      // shouldn't read as removed.
                      const dim = !checked && !row.frozen;
                      return (
                        <div key={row.name} className="space-y-1">
                        <div
                          className={`flex items-center gap-2 ${dim ? 'opacity-50' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(row.name)}
                            className="h-4 w-4 shrink-0"
                            aria-label={`Publish ${row.name}`}
                          />
                          <span
                            className="w-36 shrink-0 truncate text-sm"
                            title={row.name}
                          >
                            {row.name}
                          </span>
                          {row.caption && (
                            <span
                              className="shrink-0 max-w-44 truncate text-xs text-muted-foreground"
                              title={row.caption}
                            >
                              {row.caption}
                            </span>
                          )}
                          {hasBlocks ? (
                            <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">
                              one page per sub-series
                            </span>
                          ) : row.frozen ? (
                            <a
                              href={row.publishedUrl ?? url}
                              target="_blank"
                              rel="noreferrer"
                              title={row.publishedUrl ?? url}
                              aria-label={row.publishedUrl ?? url}
                              className="flex-1 min-w-0 truncate text-xs font-mono hover:underline"
                            >
                              {segment}
                            </a>
                          ) : (
                            <Input
                              value={segment}
                              onChange={(e) => {
                                const v = sanitizeSlug(e.target.value);
                                setSubPaths((p) => ({ ...p, [row.name]: v }));
                                setError(null);
                              }}
                              disabled={!checked}
                              placeholder={defaultSubPath(row.name)}
                              aria-label={`URL for ${row.name}`}
                              className="flex-1 min-w-0 h-7 text-xs font-mono"
                            />
                          )}
                          {noteButton({ fleetName: row.name })}
                          {row.frozen &&
                            !hasBlocks &&
                            changeUrlButton(row.name, row.publishedUrl ?? url, (segment) => {
                              setSubPaths((p) => ({ ...p, [row.name]: segment }));
                              setSelected((sel) => new Set(sel).add(row.name));
                            })}
                          {row.frozen && !hasBlocks && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0"
                              onClick={() => navigator.clipboard.writeText(row.publishedUrl ?? url)}
                            >
                              Copy
                            </Button>
                          )}
                        </div>
                        {unscoredByPage.has(row.name) && (
                          <p className="pl-6 text-xs text-destructive">
                            {formatNameList(unscoredByPage.get(row.name)!.map((u) => u.raceLabel))}
                            {unscoredByPage.get(row.name)!.length === 1 ? ' is' : ' are'} not scored
                            yet — waiting for the course. This page is held until you enter it, or
                            publish without the race.
                          </p>
                        )}
                        {noteEditor({ fleetName: row.name }, row.name)}
                        </div>
                      );
                    })}
                    {/* Fleets while individual pages are off: visible so
                        nothing reads as vanished, but not selectable — they
                        publish through the combined pages (or, uncovered,
                        not at all). */}
                    {suppressedRows.map((row) => {
                      const note = row.groupNames.length > 0
                        ? `→ in ${row.groupNames.join(', ')}`
                        : 'not on any combined page — not published';
                      return (
                        <div
                          key={`suppressed-${row.name}`}
                          className="flex items-center gap-2 opacity-50"
                          data-testid={`suppressed-fleet-${row.name}`}
                        >
                          <span className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span
                            className="w-36 shrink-0 truncate text-sm"
                            title={row.name}
                          >
                            {row.name}
                          </span>
                          <span
                            className="flex-1 min-w-0 truncate text-xs text-muted-foreground"
                            title={note}
                          >
                            {note}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : isPublished ? (
              // A publication can carry pages the dialog cannot enumerate
              // before publishing, so the published view lists every live
              // results page, not just the first. The prize sheet and the
              // other extra pages keep their own rows below.
              <div className="space-y-1.5">
                {(publishedResultPages ?? (singlePreview ? [singlePreview] : [])).map((p) => (
                  <div key={p.url} className="space-y-1">
                  <div className="flex items-center gap-2">
                    {/* Re-publishing is per page here as much as anywhere: a
                        live page left unticked stays up untouched rather than
                        being rebuilt. Only the lone default page can be
                        singled out — the others reach the server by name, and
                        this branch is where the dialog does not reliably know
                        them. */}
                    <input
                      type="checkbox"
                      checked={publishedResultPages ? true : loneSelected}
                      disabled={!!publishedResultPages}
                      onChange={(e) => { setLoneSelected(e.target.checked); setError(null); }}
                      className="h-4 w-4 shrink-0"
                      aria-label={`Publish ${publishedResultPages ? p.fleetName : lonePageLabel}`}
                      title={publishedResultPages ? undefined : 'Untick to leave this page as it is'}
                    />
                    {publishedResultPages && (
                      <span className="w-36 shrink-0 truncate text-sm" title={p.fleetName}>
                        {p.fleetName}
                      </span>
                    )}
                    <div className="flex-1 min-w-0 overflow-hidden">
                      {/* direction: rtl makes the ellipsis clip the (shared) start of
                          the URL and keep the distinguishing end visible; text-align:
                          left keeps it left-aligned when it fits. The URL is a single
                          LTR run so its character order is unaffected. */}
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        title={p.url}
                        className="text-xs font-mono truncate block hover:underline"
                        style={{ direction: 'rtl', textAlign: 'left' }}
                      >
                        {p.url}
                      </a>
                    </div>
                    {noteButton(publishedResultPages ? { fleetName: p.fleetName } : lonePageRef)}
                    {!publishedResultPages &&
                      !hasBlocks &&
                      changeUrlButton(lonePageLabel, p.url, (segment) => {
                        setSinglePath(segment);
                        setLoneSelected(true);
                      })}
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => navigator.clipboard.writeText(p.url)}>
                      Copy
                    </Button>
                  </div>
                  {noteEditor(
                    publishedResultPages ? { fleetName: p.fleetName } : lonePageRef,
                    publishedResultPages ? p.fleetName : lonePageLabel,
                  )}
                  </div>
                ))}
                {/* The results page has never gone out — the publication is an
                    entry list, or a prize sheet, alone. Offer it here, unticked
                    and with an editable URL, exactly as a not-yet-live extra
                    page is offered below; otherwise there is no way to publish
                    it later. */}
                {!publishedResultPages && !singlePreview && (
                  <div className="space-y-1">
                  <div className={`flex items-center gap-2 ${loneSelected ? '' : 'opacity-50'}`}>
                    <input
                      type="checkbox"
                      checked={loneSelected}
                      onChange={(e) => { setLoneSelected(e.target.checked); setError(null); }}
                      className="h-4 w-4 shrink-0"
                      aria-label={`Publish ${lonePageLabel}`}
                    />
                    <span className="w-36 shrink-0 truncate text-sm">{lonePageLabel}</span>
                    <Input
                      value={singlePath}
                      onChange={(e) => { setSinglePath(sanitizeSlug(e.target.value)); setError(null); }}
                      placeholder={defaultPageSlug(raceResults)}
                      aria-label="Page URL"
                      className="flex-1 min-w-0 h-7 text-xs font-mono"
                    />
                    {noteButton(lonePageRef)}
                  </div>
                  {noteEditor(lonePageRef, lonePageLabel)}
                  </div>
                )}
              </div>
            ) : hasBlocks ? (
              <p className="text-xs text-muted-foreground truncate" title={`${urlPrefix}/`}>
                Each sub-series publishes its own page under{' '}
                <span className="font-mono">/p/{workspaceSlug}/{effectiveSlug || '…'}/</span>
              </p>
            ) : (
              // First publish of a single-fleet series: the standings page,
              // laid out symmetrically with its optional prizes sibling below
              // — a (fixed) checkbox, the page name, its editable segment.
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground truncate" title={`${urlPrefix}/${folder || '…'}/`}>
                  Pages live under{' '}
                  <span className="font-mono">
                    /p/{workspaceSlug}/{effectiveSlug || '…'}/{folder || '…'}/
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={loneSelected}
                    onChange={(e) => { setLoneSelected(e.target.checked); setError(null); }}
                    className="h-4 w-4 shrink-0"
                    aria-label={`Publish ${lonePageLabel}`}
                  />
                  <span className="w-36 shrink-0 truncate text-sm">{lonePageLabel}</span>
                  <Input
                    value={singlePath}
                    onChange={(e) => {
                      setSinglePath(sanitizeSlug(e.target.value));
                      setError(null);
                    }}
                    placeholder={defaultPageSlug(raceResults)}
                    aria-label="Page URL"
                    className="flex-1 min-w-0 h-7 text-xs font-mono"
                  />
                  {noteButton(lonePageRef)}
                </div>
                {noteEditor(lonePageRef, lonePageLabel)}
              </div>
            )}

            {/* A single-fleet series' other pages — an axis-sectioned page,
                the prize sheet — each an optional row below the lone results
                page (multi-fleet series list them as ordinary rows above). */}
            {extraPageNames.map((name) => {
              const frozen = frozenPage(name);
              const url =
                (published?.pages ?? []).find((p) => p.fleetName === name)?.url ??
                `${urlPrefix}/${subPaths[name] || defaultSubPath(name)}`;
              const checked = selected.has(name);
              const caption = captionByName.get(name);
              return (
                <div key={name} className="space-y-1">
                <div
                  className={`flex items-center gap-2 ${!checked && !frozen ? 'opacity-50' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(name)}
                    className="h-4 w-4 shrink-0"
                    aria-label={`Publish ${name}`}
                  />
                  <span className="w-36 shrink-0 truncate text-sm" title={name}>
                    {name}
                  </span>
                  {caption && (
                    <span
                      className="shrink-0 max-w-44 truncate text-xs text-muted-foreground"
                      title={caption}
                    >
                      {caption}
                    </span>
                  )}
                  {frozen ? (
                    // Same treatment as the published standings link: the full
                    // URL, rtl-truncated so the distinguishing tail stays
                    // visible when it clips.
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      title={url}
                      className="flex-1 min-w-0 truncate text-xs font-mono hover:underline"
                      style={{ direction: 'rtl', textAlign: 'left' }}
                    >
                      {url}
                    </a>
                  ) : (
                    <Input
                      value={subPaths[name] ?? ''}
                      onChange={(e) => {
                        const v = sanitizeSlug(e.target.value);
                        setSubPaths((p) => ({ ...p, [name]: v }));
                        setError(null);
                      }}
                      disabled={!checked}
                      placeholder={defaultSubPath(name)}
                      aria-label={`URL for ${name}`}
                      className="flex-1 min-w-0 h-7 text-xs font-mono"
                    />
                  )}
                  {noteButton({ fleetName: name })}
                  {frozen &&
                    !hasBlocks &&
                    changeUrlButton(name, url, (segment) => {
                      setSubPaths((p) => ({ ...p, [name]: segment }));
                      setSelected((sel) => new Set(sel).add(name));
                    })}
                  {frozen && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => navigator.clipboard.writeText(url)}
                    >
                      Copy
                    </Button>
                  )}
                </div>
                {noteEditor({ fleetName: name }, name)}
                </div>
              );
            })}

            {/* The note that goes on every page of the publication, and any
                note left behind by a page the series no longer builds. */}
            {canNote && (
              <div className="space-y-1 border-t pt-2">
                <div className="flex items-center gap-2">
                  <span className="w-36 shrink-0 truncate text-sm text-muted-foreground">
                    Every page
                  </span>
                  <span
                    className="flex-1 min-w-0 truncate text-xs text-muted-foreground"
                    title={series.seriesNote || undefined}
                  >
                    {series.seriesNote?.trim()
                      ? series.seriesNote
                      : 'No note on every page.'}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 p-0"
                    aria-label="Note on every page"
                    title={series.seriesNote || 'Add a note to every page'}
                    data-testid="page-note-button-every-page"
                    onClick={() => setOpenNote(openNote === SERIES_NOTE ? null : SERIES_NOTE)}
                  >
                    <StickyNote
                      className={`h-4 w-4 ${series.seriesNote?.trim() ? 'fill-amber-200 text-amber-700 dark:fill-amber-900 dark:text-amber-400' : 'text-muted-foreground'}`}
                    />
                  </Button>
                </div>
                {openNote === SERIES_NOTE && (
                  <PageNoteEditor
                    value={series.seriesNote ?? ''}
                    label="every page"
                    placeholder="Something every page of this publication should say"
                    onSave={(text) => saveNote(null, text)}
                    onCancel={() => setOpenNote(null)}
                  />
                )}
                {orphanNotes.map((note) => (
                  <div key={note.page} className="flex items-center gap-2 opacity-60">
                    <span className="w-36 shrink-0 truncate text-xs text-muted-foreground">
                      {describePageNoteKey(note.page)}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground" title={note.text}>
                      no such page any more — {note.text}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 px-2 text-xs"
                      onClick={() =>
                        updateSeries.mutate({
                          id: series.id,
                          patch: (s) => ({
                            pageNotes: (s.pageNotes ?? []).filter((n) => n.page !== note.page),
                          }),
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* The refusal, before the button rather than after it: which
                race is unscored, and the one decision that gets past it.
                Publishing without the race is not publishing a blank column —
                the race is already out of the standings, and every page says
                what it is waiting for. */}
            {heldSelected && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 space-y-2">
                <p className="text-sm text-destructive">
                  {formatNameList(heldNow.map((u) => `${u.raceLabel} (${u.fleetName})`))}{' '}
                  {heldNow.length === 1 ? 'is' : 'are'} not scored yet — the start has no course for
                  the fleet&apos;s scoring option to correct over. Enter the course, or publish the
                  races that are scored.
                </p>
                <label className="flex items-start gap-2 text-sm text-destructive">
                  <input
                    type="checkbox"
                    checked={allowUnscored}
                    onChange={(e) => { setAllowUnscored(e.target.checked); setError(null); }}
                    className="h-4 w-4 mt-0.5 shrink-0"
                  />
                  <span>
                    Publish without{' '}
                    {formatNameList([...new Set(heldNow.map((u) => u.raceLabel))])}. The pages say
                    the race is waiting for its course.
                  </span>
                </label>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {isPublished && (
            <Button
              variant="destructive"
              onClick={handleUnpublish}
              disabled={isPublishing || isUnpublishing || isRetracting}
            >
              {isUnpublishing ? 'Unpublishing…' : 'Unpublish'}
            </Button>
          )}
          <Button
            onClick={() => handlePublish()}
            disabled={
              isLoading ||
              isPublishing ||
              isUnpublishing ||
              isRetracting ||
              (!isPublished && !season) ||
              // Held, and the scorer hasn't said to publish without the race.
              // Unticking the held page clears this as surely as the checkbox
              // does — both are the decision the server would otherwise make
              // for them at the worst moment to hear it.
              (heldSelected && !allowUnscored) ||
              validation !== null
            }
          >
            {isPublishing ? 'Publishing…' : isPublished ? 'Re-publish' : 'Publish'}
          </Button>
        </DialogFooter>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}
