"use client";

import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EnergyPulseModel, MacroEventRiskModel } from "@/lib/smart-insights-client";

import { EnergyPulsePanel } from "./EnergyPulsePanel";
import { EventRiskPanel } from "./EventRiskPanel";

export type MacroPulseState = "idle" | "loading" | "loaded" | "failed";

export function MacroQuantPulseTabs({
  regimeContent,
  eventRisk,
  energy,
  state,
  locale,
}: {
  regimeContent: ReactNode;
  eventRisk: MacroEventRiskModel | null;
  energy: EnergyPulseModel | null;
  state: MacroPulseState;
  locale: "vi" | "en";
}) {
  return (
    <Tabs defaultValue="regime" className="min-w-0">
      <div className="overflow-x-auto pb-1">
        <TabsList className="h-auto min-w-max justify-start">
          <TabsTrigger value="regime">Regime</TabsTrigger>
          <TabsTrigger value="events">Event Risk</TabsTrigger>
          <TabsTrigger value="energy">Energy</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="regime" className="mt-4 min-w-0">
        {regimeContent}
      </TabsContent>
      <TabsContent value="events" className="mt-4 min-w-0">
        <EventRiskPanel data={eventRisk} state={state} locale={locale} />
      </TabsContent>
      <TabsContent value="energy" className="mt-4 min-w-0">
        <EnergyPulsePanel data={energy} state={state} locale={locale} />
      </TabsContent>
    </Tabs>
  );
}
