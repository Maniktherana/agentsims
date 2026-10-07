import { AlertCircleIcon, Alert02Icon, Bug01Icon, InformationCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo } from "react";
import type { LogRecord } from "../../../core/tools/logs/contracts";
import { sourceLabel } from "../../console/state";
import { consoleLevelStyle, consoleStyles } from "./console-variants";

/** Immutable occurrences let scrolling and source status updates reuse visible rows. */
export const LogRow = memo(function LogRow({ record, deviceName, showIdentity = false, wrap, timestamps }: {
	record: LogRecord; deviceName: string; showIdentity?: boolean; wrap: boolean; timestamps: boolean;
}) {
	return <div data-log-id={record.id} className={`${consoleStyles.row} ${consoleLevelStyle(record.level)}`}
		title={[deviceName, record.device, sourceLabel(record.source), record.level, record.app, record.process, record.tag, record.truncated ? "Truncated by source" : undefined].filter(Boolean).join(" · ")}>
		<HugeiconsIcon role="img" aria-label={`${record.level} log`} className={consoleStyles.severity}
			icon={record.level === "error" || record.level === "fatal" ? AlertCircleIcon : record.level === "warn" ? Alert02Icon
				: record.level === "debug" || record.level === "trace" ? Bug01Icon : InformationCircleIcon} strokeWidth={1.8} />
		{timestamps && <span className={consoleStyles.identity}>{record.sourceTime?.text ?? new Date(record.receivedAt).toISOString().slice(11, 23)}</span>}
		{showIdentity && <><span className={`${consoleStyles.identity} max-w-28 truncate`}>{deviceName}</span><span className={consoleStyles.identity}>{sourceLabel(record.source)}</span></>}
		<span className={`${consoleStyles.message} ${wrap ? consoleStyles.wrapped : consoleStyles.unwrapped}`}>
			{record.tag && <span className={consoleStyles.muted}>{record.tag}: </span>}{record.message}
			{record.stack && <>{"\n"}{record.stack}</>}
			{record.truncated && <span className={consoleStyles.muted}>{"\n"}[truncated by source]</span>}
		</span>
	</div>;
});
