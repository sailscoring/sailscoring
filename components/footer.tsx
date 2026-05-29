export function Footer() {
  return (
    <footer className="border-t px-6 py-3 mt-8 text-xs text-muted-foreground flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <a
        href="https://sailscoring.ie/legal/privacy"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline hover:text-foreground"
      >
        Privacy
      </a>
      <a
        href="https://sailscoring.ie/legal/terms"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline hover:text-foreground"
      >
        Terms
      </a>
    </footer>
  );
}
