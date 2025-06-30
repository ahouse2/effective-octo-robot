import { toast } from "sonner";

const triggerDownload = (blob: Blob, filename: string) => {
  try {
    // Create a URL for the blob
    const url = window.URL.createObjectURL(blob);
    
    // Create a temporary anchor element
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    
    // Append to the DOM, trigger the click, and remove it
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Release the object URL
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error triggering download:", error);
    throw error; // Re-throw to be caught by the caller
  }
};

export const downloadTextFile = (content: string, filename: string) => {
  if (typeof content !== 'string' || !filename) {
    console.error("Invalid arguments for downloadTextFile", { content, filename });
    toast.error("Failed to export: Invalid data provided.");
    return;
  }
  try {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    triggerDownload(blob, filename);
    toast.success("Export successful!");
  } catch (error: any) {
    console.error("Error downloading text file:", error);
    toast.error(`Failed to export file: ${error.message}`);
  }
};

export const downloadBlob = (blob: unknown, filename: string) => {
    if (!(blob instanceof Blob)) {
        console.error("Invalid data provided to downloadBlob. Expected a Blob, but received:", typeof blob, blob);
        toast.error("Failed to download: The server did not return a valid file.");
        return;
    }
    if (!filename) {
        console.error("Invalid arguments for downloadBlob", { blob, filename });
        toast.error("Failed to download: Filename is missing.");
        return;
    }
    try {
        triggerDownload(blob, filename);
        toast.success("Download started successfully!");
    } catch (error: any) {
        console.error("Error downloading blob:", error);
        toast.error(`Failed to start download: ${error.message}`);
    }
};