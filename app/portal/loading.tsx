export default function Loading() {
  return (
    <main aria-busy="true" aria-live="polite">
      <p className="sr-only">Loading your projects</p>
      <div className="skeleton" style={{ height: 72, marginBottom: 16 }} />
      <div className="grid metrics">{[1, 2, 3, 4].map((item) => <div key={item} className="skeleton" />)}</div>
    </main>
  );
}