const ALLOWED = new Map<string, string>([
  ["pdf", "application/pdf"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["txt", "text/plain"],
  ["md", "text/markdown"],
  ["csv", "text/csv"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["zip", "application/zip"],
]);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

export function detectUpload(fileName: string, bytes: Uint8Array) {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const mediaType = ALLOWED.get(extension);
  if (!mediaType) {
    return { ok: false as const, message: "This file type is not allowed." };
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
    return { ok: false as const, message: "Files must be between 1 byte and 10 MB." };
  }

  const office = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  const detected =
    startsWith(bytes, [0x25, 0x50, 0x44, 0x46]) ? "pdf" :
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) ? "png" :
    startsWith(bytes, [0xff, 0xd8, 0xff]) ? "jpeg" :
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) ? "gif" :
    (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) ? "webp" :
    office ? "zip" :
    null;

  if (startsWith(bytes, [0x4d, 0x5a]) || startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) {
    return { ok: false as const, message: "Executable files are not allowed." };
  }

  const text = extension === "txt" || extension === "md" || extension === "csv";
  if (text) {
    if (bytes.includes(0)) return { ok: false as const, message: "Text files cannot contain binary data." };
    return { ok: true as const, mediaType };
  }

  const matches =
    (extension === "pdf" && detected === "pdf") ||
    (extension === "png" && detected === "png") ||
    ((extension === "jpg" || extension === "jpeg") && detected === "jpeg") ||
    (extension === "gif" && detected === "gif") ||
    (extension === "webp" && detected === "webp") ||
    ((extension === "docx" || extension === "xlsx" || extension === "zip") && detected === "zip");

  if (!matches) {
    return { ok: false as const, message: "The file contents do not match its extension." };
  }
  return { ok: true as const, mediaType };
}
