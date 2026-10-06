"use client";

export default function WorkspaceError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="card">
      <h1>This page could not be loaded</h1>
      <p>{error.message || "The request failed. Your previous entries were not changed."}</p>
      <button className="btn btn-primary" type="button" onClick={reset}>Try again</button>
    </main>
  );
}
