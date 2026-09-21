import { useRef, type CSSProperties } from "react";
import { TextMorph } from "torph/react";

/** Keep the counter slot steady while Torph changes its digits. */
export function NumberMorph({
	children,
	className,
	style,
}: {
	children: number | string;
	className?: string;
	style?: CSSProperties;
}) {
	const value = String(children);
	const places = useRef(value.length);
	places.current = Math.max(places.current, value.length);
	return (
		<span
			className={className}
			style={{
				display: "inline-grid",
				minWidth: `${places.current}ch`,
				fontVariantNumeric: "tabular-nums",
				...style,
			}}
		>
			<TextMorph style={{ gridArea: "1 / 1", justifySelf: "end" }}>
				{value}
			</TextMorph>
		</span>
	);
}
