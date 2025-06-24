import React from "react";
import { cn } from "@/lib/utils";
import { PackageOpen } from "lucide-react";

interface EmptyPlaceholderProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ElementType;
  title?: string;
  description?: string;
}

export const EmptyPlaceholder: React.FC<EmptyPlaceholderProps> = ({
  icon: Icon = PackageOpen, // Default icon
  title = "No content found",
  description = "It looks like there's nothing here yet.",
  className,
  ...props
}) => {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-8 text-center text-muted-foreground",
        className
      )}
      {...props}
    >
      <Icon className="h-12 w-12 mb-4 text-gray-400 dark:text-gray-600" />
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-sm max-w-md">{description}</p>
    </div>
  );
};