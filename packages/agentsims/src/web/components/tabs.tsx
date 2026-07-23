import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type * as React from "react";

type TabsVariant = "default" | "ghost" | "underline";

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props): React.ReactElement {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={classes(
        "flex flex-col gap-2 data-[orientation=vertical]:flex-row",
        typeof className === "string" ? className : undefined,
      )}
      {...props}
    />
  );
}

function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: TabsPrimitive.List.Props & {
  variant?: TabsVariant;
}): React.ReactElement {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={classes(
        "relative z-0 flex w-fit items-center justify-center gap-x-0.5 text-white/45 data-[orientation=vertical]:flex-col",
        variant === "default" && "rounded-lg bg-white/[0.045] p-0.5 text-white/68",
        variant === "ghost" &&
          "rounded-lg p-0.5 text-white/68 [&>[data-slot=tabs-trigger]:hover]:text-white",
        variant === "underline" &&
          "data-[orientation=horizontal]:py-1 data-[orientation=vertical]:px-1",
        typeof className === "string" ? className : undefined,
      )}
      {...props}
    >
      {children}
      <TabsPrimitive.Indicator
        data-slot="tabs-indicator"
        className={classes(
          "pointer-events-none absolute bottom-0 left-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) -translate-y-(--active-tab-bottom) transition-[width,translate] duration-200 ease-in-out",
          variant === "underline" &&
            "z-20 bg-white data-[orientation=horizontal]:h-0.5 data-[orientation=horizontal]:translate-y-px data-[orientation=vertical]:w-0.5 data-[orientation=vertical]:-translate-x-px",
          variant === "default" && "z-0 rounded-md bg-white/[0.1]",
          variant === "ghost" && "z-0 rounded-md bg-white/[0.1] shadow-none",
        )}
      />
    </TabsPrimitive.List>
  );
}

function TabsTrigger({
  className,
  ...props
}: TabsPrimitive.Tab.Props): React.ReactElement {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={classes(
        "relative z-10 flex h-8 shrink-0 grow cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-2.5 text-[11px] font-medium leading-none text-white/45 outline-none transition-[color,box-shadow] hover:text-white/78 focus-visible:ring-1 focus-visible:ring-white/45 disabled:pointer-events-none disabled:opacity-50 data-active:text-white/90 data-disabled:pointer-events-none data-disabled:opacity-50 data-[orientation=vertical]:w-full data-[orientation=vertical]:justify-start",
        typeof className === "string" ? className : undefined,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: TabsPrimitive.Panel.Props): React.ReactElement {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={classes(
        "flex-1 outline-none",
        typeof className === "string" ? className : undefined,
      )}
      {...props}
    />
  );
}

export {
  Tabs,
  TabsContent,
  TabsList,
  TabsPrimitive,
  TabsTrigger,
  type TabsVariant,
  TabsContent as TabsPanel,
  TabsTrigger as TabsTab,
};
