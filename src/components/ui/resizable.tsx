"use client";

import * as React from "react";
import { ResizablePanelGroup as ResizablePanelGroupPrimitive, ResizablePanel as ResizablePanelPrimitive, PanelResizeHandle as PanelResizeHandlePrimitive } from "react-resizable-panels";
import { GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";

const ResizablePanelGroup = React.forwardRef<
  React.ElementRef<typeof ResizablePanelGroupPrimitive>,
  React.ComponentPropsWithoutRef<typeof ResizablePanelGroupPrimitive>
>(({ className, ...props }, ref) => (
  <ResizablePanelGroupPrimitive
    ref={ref}
    className={cn(
      "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
      className,
    )}
    {...props}
  />
));
ResizablePanelGroup.displayName = "ResizablePanelGroup";

const ResizablePanel = React.forwardRef<
  React.ElementRef<typeof ResizablePanelPrimitive>,
  React.ComponentPropsWithoutRef<typeof ResizablePanelPrimitive>
>(({ className, ...props }, ref) => (
  <ResizablePanelPrimitive
    ref={ref}
    className={cn(className)}
    {...props}
  />
));
ResizablePanel.displayName = "ResizablePanel";

const ResizableHandle = React.forwardRef<
  React.ElementRef<typeof PanelResizeHandlePrimitive>,
  React.ComponentPropsWithoutRef<typeof PanelResizeHandlePrimitive> & {
    withHandle?: boolean;
  }
>(({ withHandle, className, ...props }, ref) => (
  <PanelResizeHandlePrimitive
    ref={ref}
    className={cn(
      "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:inset-x-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:-translate-x-0",
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-4 items-center justify-center rounded-full border bg-background">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </PanelResizeHandlePrimitive>
));
ResizableHandle.displayName = "ResizableHandle";

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };