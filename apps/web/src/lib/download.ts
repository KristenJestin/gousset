/** Hands a text to the browser as a file to save under `fileName`, as a link to it would. */
export function downloadText(fileName: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  link.click();
  // Once the browser has taken the file: revoking at once may cancel the download in some.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
