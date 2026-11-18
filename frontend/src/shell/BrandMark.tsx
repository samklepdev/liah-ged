/** The circular "LH" seal used as the app's wordmark, in the nav bar and on auth screens. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={className ? `brand-seal ${className}` : 'brand-seal'} aria-hidden="true">
      LH
    </span>
  );
}
