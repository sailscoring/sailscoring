import type { AppDisplay } from '@/lib/auth/oauth';

/** An app's name, linked to its site where it registered one. */
export function AppName({ app }: { app: AppDisplay }) {
  if (!app.uri) return <>{app.name}</>;
  return (
    <a href={app.uri} target="_blank" rel="noopener noreferrer" className="underline">
      {app.name}
    </a>
  );
}
