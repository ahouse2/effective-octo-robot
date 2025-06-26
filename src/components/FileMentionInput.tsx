import React, { useState, useEffect, useRef } from "react";
import { Textarea, TextareaProps } from "@/components/ui/textarea";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger, PopoverAnchor } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText } from "lucide-react";

interface FileMetadata {
  id: string;
  file_name: string;
  suggested_name: string | null;
}

interface FileMentionInputProps extends Omit<TextareaProps, 'onChange'> {
  caseId: string;
  value: string;
  onChange: (value: string) => void;
}

export const FileMentionInput: React.FC<FileMentionInputProps> = ({
  caseId,
  value,
  onChange,
  ...props
}) => {
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const lastAtPosition = useRef<number | null>(null);

  useEffect(() => {
    if (!caseId) return;

    const fetchFiles = async () => {
      const { data, error } = await supabase
        .from("case_files_metadata")
        .select("id, file_name, suggested_name")
        .eq("case_id", caseId)
        .order("suggested_name", { ascending: true });

      if (error) {
        toast.error("Failed to load files for mentions.");
        console.error(error);
      } else {
        setFiles(data || []);
      }
    };

    fetchFiles();
  }, [caseId]);

  const handleValueChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    const cursorPos = e.target.selectionStart;
    const textUpToCursor = newValue.substring(0, cursorPos);
    const atPos = textUpToCursor.lastIndexOf('@');

    if (atPos !== -1 && !/\s/.test(newValue.substring(atPos + 1, cursorPos))) {
      lastAtPosition.current = atPos;
      setMentionQuery(newValue.substring(atPos + 1, cursorPos));
      setPopoverOpen(true);
    } else {
      setPopoverOpen(false);
    }
  };

  const handleFileSelect = (file: FileMetadata) => {
    const fileNameToInsert = file.suggested_name || file.file_name;
    if (lastAtPosition.current !== null) {
      const textBefore = value.substring(0, lastAtPosition.current);
      const textAfter = value.substring(lastAtPosition.current + 1 + mentionQuery.length);
      const newValue = `${textBefore}@'${fileNameToInsert}' ${textAfter}`;
      onChange(newValue);
    }
    setPopoverOpen(false);
  };

  return (
    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
      <PopoverAnchor asChild>
        <Textarea
          value={value}
          onChange={handleValueChange}
          {...props}
        />
      </PopoverAnchor>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command
          filter={(value, search) => {
            const file = files.find(f => f.id === value);
            const name = file?.suggested_name || file?.file_name || '';
            return name.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput
            placeholder="Search for a file to mention..."
            value={mentionQuery}
            onValueChange={setMentionQuery}
          />
          <CommandList>
            <CommandEmpty>No files found.</CommandEmpty>
            <CommandGroup>
              {files.map((file) => (
                <CommandItem
                  key={file.id}
                  value={file.id}
                  onSelect={() => handleFileSelect(file)}
                  className="cursor-pointer"
                >
                  <FileText className="mr-2 h-4 w-4" />
                  <span>{file.suggested_name || file.file_name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};