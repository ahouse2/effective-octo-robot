"use client"

import * as React from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
  Bar,
  BarChart,
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts"
import {
  type NameType,
  type ValueType,
} from "recharts/types/component/DefaultTooltipContent"

import { cn } from "@/lib/utils"

const ChartContext = React.createContext<
  React.ComponentProps<typeof ChartContainer>
>(null as any)

function ChartContainer<T extends React.ElementType>({
  children,
  className,
  as: Comp = "div",
  ...props
}: React.ComponentProps<T> & {
  as?: T
}) {
  return (
    <ChartContext.Provider value={props}>
      <Comp
        className={cn(
          "flex h-[400px] w-full flex-col items-center justify-center",
          className
        )}
        {...props}
      >
        {children}
      </Comp>
    </ChartContext.Provider>
  )
}

function ChartTooltip({
  active,
  payload,
  label,
  formatter,
  className,
}: TooltipProps<ValueType, NameType> & { className?: string }) {
  if (active && payload && payload.length) {
    return (
      <div
        className={cn(
          "rounded-lg border bg-background p-2 text-sm shadow-md",
          className
        )}
      >
        <p className="font-bold">{label}</p>
        {payload.map((entry, index) => (
          <div key={`item-${index}`} className="flex justify-between gap-2">
            <span className="text-muted-foreground">{entry.name}:</span>
            <span className="font-bold">
              {formatter ? formatter(entry.value, entry.name, entry, index, payload) : entry.value}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return null
}

export {
  ChartContainer,
  ChartTooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
}