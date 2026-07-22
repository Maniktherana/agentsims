import { Check, Clipboard, Eye, EyeOff, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { AxElement } from "../model";
import { SimulatorToolbar } from "../../web/simulator";
import {
  useAnnotationContext,
  useAxSelectionContext,
  useAxSnapshotContext,
} from "./use-ax-snapshot";
import { annotationTargetElements, axElementKey } from "./ax";
import { buildAnnotationPrompt, copyAnnotationText } from "./prompt";

function selectedElementForKey(elements: AxElement[], key: string | null) {
  if (!key) return null;
  return elements.find((element) => axElementKey(element) === key) ?? null;
}

export function AnnotationToolbarActions({
  udid,
  deviceName,
  deviceRuntime,
  currentApp,
}: {
  udid: string;
  deviceName?: string | null;
  deviceRuntime?: string | null;
  currentApp?: { bundleId: string; isReactNative: boolean; pid?: number } | null;
}) {
  const { snapshot } = useAxSnapshotContext();
  const { selectedKey } = useAxSelectionContext();
  const {
    annotations,
    markersVisible,
    setMarkersVisible,
    clearAnnotations,
  } = useAnnotationContext();
  const [copied, setCopied] = useState(false);
  const elements = snapshot ? annotationTargetElements(snapshot.elements, snapshot.screen) : [];
  const selectedElement = selectedElementForKey(elements, selectedKey);
  const prompt = useMemo(
    () => buildAnnotationPrompt({
      udid,
      deviceName,
      deviceRuntime,
      currentApp,
      selectedElement,
      annotations,
    }),
    [annotations, currentApp, deviceName, deviceRuntime, selectedElement, udid],
  );
  const empty = annotations.length === 0;

  return (
    <>
      <SimulatorToolbar.Button
        aria-label={markersVisible ? "Hide annotation markers" : "Show annotation markers"}
        aria-pressed={markersVisible}
        title={markersVisible ? "Hide markers" : "Show markers"}
        disabled={empty}
        onClick={() => setMarkersVisible(!markersVisible)}
      >
        {markersVisible
          ? <Eye size={18} strokeWidth={2} />
          : <EyeOff size={18} strokeWidth={2} />}
      </SimulatorToolbar.Button>
      <SimulatorToolbar.Button
        aria-label="Copy annotations"
        title={copied ? "Copied" : `Copy ${annotations.length} annotation${annotations.length === 1 ? "" : "s"}`}
        disabled={empty}
        onClick={async () => {
          if (!(await copyAnnotationText(prompt))) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied
          ? <Check size={18} strokeWidth={2.2} />
          : <Clipboard size={18} strokeWidth={2} />}
      </SimulatorToolbar.Button>
      <SimulatorToolbar.Button
        aria-label="Clear annotations"
        title="Clear annotations"
        disabled={empty}
        onClick={clearAnnotations}
      >
        <Trash2 size={18} strokeWidth={2} />
      </SimulatorToolbar.Button>
    </>
  );
}
