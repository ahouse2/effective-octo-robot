import { toast } from "sonner";

const triggerDownload = (blob: Blob, filename: string) => {
  try {
    console.log(`[Download] Triggering download for: ${filename}, Blob size: ${blob.size}, Blob type: ${blob.type}`);
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    
    document.body.appendChild(a);
    a.click();
    
    // Cleanup
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    console.log(`[Download] Download triggered for ${filename}.`);
  } catch (error) {
    console.error("[Download] Error in triggerDownload:", error);
    toast.error("A browser error prevented the download.");
    throw error;
  }
};

export const downloadTextFile = (content: string, filename: string) => {
  console.log(`[Download] Creating text file for download: ${filename}`);
  if (typeof content !== 'string' || !filename) {
    console.error("[Download] Invalid arguments for downloadTextFile", { content, filename });
    toast.error("Failed to export: Invalid data provided.");
    return;
  }
  try {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    triggerDownload(blob, filename);
    toast.success("Export successful!");
  } catch (error: any) {
    console.error("[Download] Error in downloadTextFile:", error);
  }
};

export const downloadBlob = (blob: unknown, filename: string) => {
    console.log(`[Download] Preparing blob for download: ${filename}`);
    if (!(blob instanceof Blob)) {
        console.error("[Download] Invalid data provided to downloadBlob. Expected a Blob, but received:", typeof blob, blob);
        toast.error("Failed to download: The server did not return a valid file.");
        return;
    }
    if (!filename) {
        console.error("[Download] Invalid arguments for downloadBlob", { blob, filename });
        toast.error("Failed to download: Filename is missing.");
        return;
    }
    try {
        triggerDownload(blob, filename);
        toast.success("Download started successfully!");
    } catch (error: any) {
        console.error("[Download] Error in downloadBlob:", error);
    }
};