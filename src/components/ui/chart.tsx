"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  Bar,
  BarChart,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils";

// Define ChartConfig and related types locally or import from a non-circular source
export type ChartConfig = {
  [k: string]: {
    label?: string;
    color?: string;
    icon?: React.ComponentType;
  };
};

type ChartContextType = {
  config?: ChartConfig;
};

const ChartContext = React.createContext<ChartContextType>({});

function useChart() {
  const context = React.useContext(ChartContext);

  if (!context) {
    throw new Error("useChart must be used within a <Chart />");
  }

  return context;
}

const Chart = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div"> & {
    config: ChartConfig;
  }
>(({ config, className, children, ...props }, ref) => (
  <ChartContext.Provider value={{ config }}>
    <div
      ref={ref}
      className={cn("flex h-full w-full flex-col", className)}
      {...props}
    >
      {children}
    </div>
  </ChartContext.Provider>
));
Chart.displayName = "Chart";

const ChartContainer = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div"> & {
    config: ChartConfig;
    className?: string;
  }
>(({ config, className, children, ...props }, ref) => {
  const newConfig = { ...useChart().config, ...config };
  return (
    <ChartContext.Provider value={{ config: newConfig }}>
      <div
        ref={ref}
        className={cn("flex h-[400px] w-full flex-col", className)}
        {...props}
      >
        {children}
      </div>
    </ChartContext.Provider>
  );
});
ChartContainer.displayName = "ChartContainer";

const ChartTooltip = Tooltip;

const ChartTooltipContent = React.forwardRef<
  HTMLDivElement, // This ref is for the outer div, not the Tooltip component itself
  React.ComponentPropsWithoutRef<typeof Tooltip> & {
    hideLabel?: boolean;
    hideIndicator?: boolean;
    className?: string;
    formatter?: (
      value: number,
      name: string,
      props: { payload: Record<string, unknown> },
    ) => string;
  }
>(({ className, hideLabel = false, hideIndicator = false, children, formatter, ...props }, ref) => {
  const { config } = useChart();
  return (
    <Tooltip
      // ref={ref} // Removed ref from Tooltip component
      content={({ active, payload }) => {
        if (active && payload && payload.length) {
          return (
            <div
              ref={ref} // Apply ref to the actual div
              className={cn(
                "grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
                className,
              )}
            >
              {!hideLabel && payload[0].name && (
                <div className="text-muted-foreground">
                  {payload[0].name}
                </div>
              )}
              <div className="grid gap-1">
                {payload.map((item, i) => {
                  const key = item.dataKey as keyof typeof config;
                  const itemConfig = config?.[key];
                  return (
                    <div
                      key={item.dataKey || i}
                      className="flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-2">
                        {!hideIndicator && itemConfig?.color && (
                          <span
                            className="flex h-2 w-2 rounded-full"
                            style={{ backgroundColor: itemConfig.color }}
                          />
                        )}
                        <span className="text-muted-foreground">
                          {itemConfig?.label || item.dataKey}
                        </span>
                      </div>
                      <span className="font-medium text-foreground">
                        {formatter ? formatter(item.value as number, item.name as string, { payload: item.payload as Record<string, unknown> }) : item.value}
                      </span>
                    </div>
                  );
                })}
              </div>
              {children} {/* Render children if any */}
            </div>
          );
        }
        return null;
      }}
      {...props}
    />
  );
});
ChartTooltipContent.displayName = "ChartTooltipContent";

const ChartLegend = Tooltip;

const ChartLegendContent = React.forwardRef<
  HTMLDivElement, // This ref is for the outer div, not the Tooltip component itself
  React.ComponentPropsWithoutRef<typeof Tooltip> & {
    className?: string;
    hideIndicator?: boolean;
  }
>(({ className, hideIndicator = false, children, ...props }, ref) => {
  const { config } = useChart();
  return (
    <Tooltip
      // ref={ref} // Removed ref from Tooltip component
      content={({ payload }) => {
        if (payload && payload.length) {
          return (
            <div
              ref={ref} // Apply ref to the actual div
              className={cn(
                "grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
                className,
              )}
            >
              <div className="grid gap-1">
                {payload.map((item, i) => {
                  const key = item.dataKey as keyof typeof config;
                  const itemConfig = config?.[key];
                  return (
                    <div
                      key={item.dataKey || i}
                      className="flex items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-2">
                        {!hideIndicator && itemConfig?.color && (
                          <span
                            className="flex h-2 w-2 rounded-full"
                            style={{ backgroundColor: itemConfig.color }}
                          />
                        )}
                        <span className="text-muted-foreground">
                          {itemConfig?.label || item.dataKey}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {children} {/* Render children if any */}
            </div>
          );
        }
        return null;
      }}
      {...props}
    />
  );
});
ChartLegendContent.displayName = "ChartLegendContent";


export {
  Chart,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  RadialBarChart,
  RadialBar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  useChart,
};