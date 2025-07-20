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
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  Legend,
  Tooltip,
  ResponsiveContainer,
  type TooltipProps,
} from "recharts";
import {
  type NameType,
  type ValueType,
} from "recharts/types/component/DefaultTooltipContent"; // Removed ContentType

import { cn } from "@/lib/utils";

// region Chart

type ChartContextType = {
  config: ChartConfig;
  /**
   * @internal
   */
  index: number;
  orientation?: "horizontal" | "vertical"; // Added orientation
};

const ChartContext = React.createContext<ChartContextType | undefined>(undefined);

type ChartConfig = {
  [k: string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType<{ className?: string }>;
  } & (
    | { type: "value"; color?: string }
    | { type: "category"; color?: string }
  );
};

type ChartContainerProps = React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ReactNode;
  orientation?: "horizontal" | "vertical"; // Added orientation
};

const ChartContainer = React.forwardRef<HTMLDivElement, ChartContainerProps>(
  ({ config, className, children, orientation = "horizontal", ...props }, ref) => {
    const uniqueId = React.useId();

    return (
      <ChartContext.Provider value={{ config, index: 0, orientation }}>
        <div
          ref={ref}
          className={cn(
            "flex h-[300px] w-full flex-col items-center justify-center",
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </ChartContext.Provider>
    );
  },
);
ChartContainer.displayName = "ChartContainer";

// endregion

// region ChartTooltip

type ChartTooltipProps = TooltipProps<ValueType, NameType> & {
  hideIndicator?: boolean;
  hideLabel?: boolean;
  children?: React.ReactNode;
};

const ChartTooltip = ({
  active,
  payload,
  hideIndicator,
  hideLabel,
  children,
}: ChartTooltipProps) => {
  const { config } = useChart();

  if (!active || !payload?.length) {
    return null;
  }

  const relevantPayload = payload.filter((item) => {
    const key = item.dataKey as keyof typeof config;
    return config[key]?.label;
  });

  return (
    <div
      className={cn(
        "grid min-w-[130px] items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs shadow-xl",
      )}
    >
      {!hideLabel && payload[0] ? (
        <div className="text-muted-foreground">
          {payload[0].payload.name || payload[0].name}
        </div>
      ) : null}
      {relevantPayload.map((item, i) => {
        const key = item.dataKey as keyof typeof config;
        const configItem = config[key];
        return (
          <div
            key={item.dataKey}
            className={cn(
              "flex w-full flex-wrap items-center justify-between gap-2",
              i === 0 && !hideLabel && "pt-1",
            )}
          >
            {configItem?.label && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {hideIndicator ? null : (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: item.color,
                    }}
                  />
                )}
                {configItem.label}
              </span>
            )}
            {item.value && (
              <span className="font-medium text-foreground">
                {item.value.toLocaleString()}
              </span>
            )}
          </div>
        );
      })}
      {children}
    </div>
  );
};

// endregion

// region ChartTooltipContent

type ChartTooltipContentProps = React.ComponentProps<typeof Tooltip> & {
  children?: React.ReactNode;
};

const ChartTooltipContent = React.forwardRef<
  HTMLDivElement, // Ref for the div inside content
  ChartTooltipContentProps
>(({ children, ...props }, ref) => {
  return (
    <Tooltip
      content={({ active, payload }) => (
        <div ref={ref}> {/* Apply ref here */}
          <ChartTooltip active={active} payload={payload}>
            {children}
          </ChartTooltip>
        </div>
      )}
      {...props}
    />
  );
});
ChartTooltipContent.displayName = "ChartTooltipContent";

// endregion

// region ChartLegend

type ChartLegendProps = React.ComponentProps<typeof Legend>;

const ChartLegend = React.forwardRef<HTMLDivElement, ChartLegendProps>(
  ({ className, ...props }, ref) => {
    return (
      <Legend
        content={({ payload }) => {
          return (
            <div
              ref={ref} // Apply ref here
              className={cn(
                "flex flex-wrap items-center justify-center gap-4",
                className,
              )}
            >
              {payload?.map((item: any) => {
                if (!item.value) return null;

                return (
                  <div
                    key={item.value}
                    className="flex items-center gap-1.5"
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{
                        backgroundColor: item.color,
                      }}
                    />
                    {item.value}
                  </div>
                );
              })}
            </div>
          );
        }}
        {...props}
      />
    );
  },
);
ChartLegend.displayName = "ChartLegend";

// endregion

// region ChartPrimitive

const ChartPrimitive = React.forwardRef<
  any, // Use any for Recharts components as their refs are complex
  React.ComponentPropsWithoutRef<typeof ResponsiveContainer> & {
    children: React.ReactNode;
  }
>(({ className, children, ...props }, ref) => {
  const { orientation } = useChart();
  return (
    <ResponsiveContainer
      ref={ref}
      className={cn(
        orientation === "horizontal" && "aspect-[2/1]",
        orientation === "vertical" && "aspect-[1/2]",
        className,
      )}
      {...props}
    >
      {children}
    </ResponsiveContainer>
  );
});
ChartPrimitive.displayName = "ChartPrimitive";

// endregion

// region Chart Components

const ChartCrosshair = ({ className, ...props }: React.ComponentProps<typeof CartesianGrid>) => {
  return (
    <CartesianGrid
      className={cn("stroke-border stroke-1", className)}
      vertical={false}
      horizontal={false}
      {...props}
    />
  );
};

const ChartAxis = ({ className, ...props }: React.ComponentProps<typeof XAxis>) => {
  return (
    <XAxis
      className={cn("fill-muted-foreground text-xs", className)}
      tickLine={false}
      axisLine={false}
      {...props}
    />
  );
};

const ChartLine = ({ className, ...props }: React.ComponentProps<typeof Line>) => {
  return (
    <Line
      className={cn("stroke-primary", className)}
      strokeWidth={2}
      dot={false}
      activeDot={{ r: 6, fill: "hsl(var(--primary))", stroke: "hsl(var(--primary))" }}
      {...props}
    />
  );
};

const ChartBar = ({ className, ...props }: React.ComponentProps<typeof Bar>) => {
  return (
    <Bar
      className={cn("fill-primary", className)}
      radius={[4, 4, 0, 0]}
      {...props}
    />
  );
};

const ChartArea = ({ className, ...props }: React.ComponentProps<typeof Area>) => {
  return (
    <Area
      className={cn("fill-primary", className)}
      strokeWidth={2}
      dot={false}
      activeDot={{ r: 6, fill: "hsl(var(--primary))", stroke: "hsl(var(--primary))" }}
      {...props}
    />
  );
};

const ChartPie = ({ className, ...props }: React.ComponentProps<typeof Pie>) => {
  return (
    <Pie
      className={cn("fill-primary", className)}
      {...props}
    />
  );
};

const ChartRadialBar = ({ className, ...props }: React.ComponentProps<typeof RadialBar>) => {
  return (
    <RadialBar
      className={cn("fill-primary", className)}
      {...props}
    />
  );
};

const ChartScatter = ({ className, ...props }: React.ComponentProps<typeof Scatter>) => {
  return (
    <Scatter
      className={cn("fill-primary", className)}
      {...props}
    />
  );
};

// endregion

// region Hooks

function useChart() {
  const context = React.useContext(ChartContext);

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }

  return context;
}

// endregion

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartPrimitive,
  ChartCrosshair,
  ChartAxis,
  ChartLine,
  ChartBar,
  ChartArea,
  ChartPie,
  ChartRadialBar,
  ChartScatter,
  useChart,
};