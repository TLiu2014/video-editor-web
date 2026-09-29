/**
 * Brand logos as inline SVGs. lucide-react v1 dropped third-party
 * brand icons (trademark / maintenance reasons), so we ship our
 * own minimal versions for the social/footer links.
 *
 * Each accepts a `className` and inherits its color from
 * `currentColor`, matching the lucide API enough for drop-in use.
 */

type SvgProps = React.SVGProps<SVGSVGElement>;

export function GithubBrandIcon(props: SvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      {...props}
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.11.78-.25.78-.55v-1.93c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.69.08-.69 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.53-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18.92-.26 1.91-.39 2.89-.39.98 0 1.97.13 2.89.39 2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .3.21.67.79.55C20.21 21.39 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

export function XBrandIcon(props: SvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      {...props}
    >
      <path d="M18.244 2H21.5l-7.36 8.41L23 22h-6.78l-5.31-6.94L4.8 22H1.54l7.87-9L1 2h6.94l4.8 6.34L18.244 2zm-2.38 18h1.88L7.22 4H5.22l10.64 16z" />
    </svg>
  );
}
