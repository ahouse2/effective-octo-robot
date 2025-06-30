import { toast } from "sonner";

export const downloadTextFile = (content: string, filename: string) => {
  try {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Export successful!");
  } catch (error) {
    console.error("Error downloading text file:", error);
    toast.error("Failed to export file.");
  }
};

export const downloadBlob = (blob: Blob, filename: string) => {
    try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("Download started successfully!");
    } catch (error) {
        console.error("Error downloading blob:", error);
        toast.error("Failed to start download.");
    }
};