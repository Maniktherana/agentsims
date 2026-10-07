import { expect, test } from "bun:test";
import {
	logRequestParams,
	parseLogRequest,
	parseLogTarget,
} from "../../../../../core/tools/logs/target";
import { parseLogQuery } from "../../../../../core/tools/logs/query";

const target = {
	device: "android:emulator-5554",
	app: { mode: "fixed" as const, id: "com.example", pid: 123 },
	reactNative: {
		projectId: "project",
		metroUrl: "http://localhost:8081/",
		targetId: "logical-page",
	},
};
test("target transport round-trips separately from historical app and process filters", () => {
	const query = parseLogQuery({
		device: target.device,
		limit: 20,
		query: "hello",
		level: "warn",
		sources: ["android-native", "react-native"],
		app: "com.other",
		pid: 456,
		process: "worker",
	});
	const params = logRequestParams(target, query);
	expect(parseLogRequest(params)).toEqual({
		target: parseLogTarget(target),
		query,
	});
	expect(params.get("targetApp")).toBe("com.example");
	expect(params.get("app")).toBe("com.other");
	expect(params.get("targetPid")).toBe("123");
	expect(params.get("pid")).toBe("456");
	expect(parseLogTarget(target).reactNative?.metroUrl).toBe(
		"http://localhost:8081",
	);
	expect(Object.isFrozen(parseLogTarget(target).app)).toBe(true);
});
test("default transport selects the foreground application", () => {
	expect(
		parseLogRequest(new URLSearchParams({ device: "ios-device" })).target,
	).toEqual({
		device: "ios-device",
		app: { mode: "foreground" },
		projectId: undefined,
		reactNative: undefined,
	});
});
test("malformed, ambiguous and incomplete target fields fail before collecting", () => {
	for (const fields of [
		{ ...target, extra: true },
		{ ...target, app: { mode: "all" } },
		{ ...target, app: { mode: "foreground", id: "com.example" } },
		{ ...target, app: { mode: "fixed", id: "" } },
		{ ...target, app: { mode: "fixed", id: "com.example", pid: -1 } },
		{ ...target, projectId: "different" },
		{
			...target,
			reactNative: {
				...target.reactNative,
				metroUrl: "http://remote.example:8081",
			},
		},
		{ ...target, reactNative: { ...target.reactNative, targetId: "\npage" } },
	])
		expect(() => parseLogTarget(fields)).toThrow();
	for (const params of [
		"device=one&targetPid=1",
		"device=one&targetApp=a&targetApp=b",
		"device=one&targetApp=a&targetPid=1.5",
		"device=one&metroUrl=http://localhost:8081",
		"device=one&unknown=1",
	])
		expect(() => parseLogRequest(new URLSearchParams(params))).toThrow();
	expect(() => logRequestParams(target, { device: "other" })).toThrow();
});
