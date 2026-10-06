export default function Loading() {
  return (
    <main aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading workspace</p>
      <div className="skeleton" style={{ height: 28, width: 260, marginBottom: 10 }} />
      <div className="skeleton" style={{ height: 16, width: 420, marginBottom: 22 }} />
      <div className="skeleton" style={{ height: 76, marginBottom: 18 }} />
      <div className="skeleton" style={{ height: 360 }} />
    </main>
  );
}
