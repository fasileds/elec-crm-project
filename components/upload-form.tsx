"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function UploadForm({ projects }: { projects: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const response = await fetch("/api/v1/documents", { method: "POST", body: new FormData(event.currentTarget) });
    const payload = (await response.json()) as { error?: { message?: string } };
    setPending(false);
    if (!response.ok) {
      setMessage(payload.error?.message ?? "Upload failed. The file was not stored.");
      return;
    }
    event.currentTarget.reset();
    setMessage("File stored.");
    router.refresh();
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      {message ? <div className={message === "File stored." ? "alert ok" : "alert"} role="status">{message}</div> : null}
      <label>Project
        <select name="projectId" required defaultValue="">
          <option value="">Choose a project</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      <label>Category
        <select name="category" defaultValue="general">{["proposal", "srs", "design", "contract", "deliverable", "general"].map((item) => <option key={item}>{item}</option>)}</select>
      </label>
      <label>File<input name="file" type="file" required /></label>
      <label className="check"><input type="checkbox" name="visibility" value="customer" /> Share with the customer. Otherwise the file stays internal.</label>
      <div className="form-actions"><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Uploading…" : "Upload file"}</button></div>
    </form>
  );
}
