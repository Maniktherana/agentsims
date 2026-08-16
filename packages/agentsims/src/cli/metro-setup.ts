import { createHash, randomUUID } from "crypto";
import {
	closeSync,
	constants,
	copyFileSync,
	existsSync,
	fchmodSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "fs";
import { createRequire } from "module";
import { basename, dirname, extname, isAbsolute, join, resolve } from "path";
import { parse } from "@babel/parser";

const AGENTSIMS_METRO = "agentsims/metro";
const MAX_CONFIG_BYTES = 512 * 1024;
const ROOT_CONFIG_NAMES = [
	"metro.config.js",
	"metro.config.cjs",
	"metro.config.mjs",
	"metro.config.ts",
	"metro.config.cts",
	"metro.config.mts",
] as const;
const UNSUPPORTED_CONFIG_NAMES = [
	"metro.config.json",
	"metro.config.yaml",
	"metro.config.yml",
] as const;

type Framework = "expo" | "react-native";
type ModuleStyle = "cjs" | "esm";

interface SourceEdit {
	start: number;
	end: number;
	text: string;
}

interface ExportTarget {
	expression: any;
	style: ModuleStyle;
}

interface ImportBinding {
	kind: "identifier" | "namespace";
	name: string;
}

interface ModuleBindings {
	named: Map<string, string>;
	namespaces: Map<string, string>;
	agentsimsBinding?: ImportBinding;
	agentsimsImport?: any;
}

export interface MetroSetupInput {
	project?: string;
	config?: string;
	cwd?: string;
}

export interface MetroSetupSystem {
	now(): Date;
	resolvePackage(projectRoot: string, request: string): string;
	/** Test seams for deterministic filesystem-race regression coverage. */
	beforeBackupCopy?(sourcePath: string, backupPath: string): void;
	beforeAtomicRename?(path: string): void;
}

export interface MetroSetupPlan {
	projectRoot: string;
	configPath: string;
	framework: Framework;
	original: string | null;
	updated: string;
	originalHash: string | null;
	status: "change" | "already-configured";
}

export interface AppliedMetroSetup {
	configPath: string;
	backupPath: string | null;
	created: boolean;
}

export interface TransformedMetroConfig {
	status: "change" | "already-configured";
	source: string;
}

export class MetroSetupError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MetroSetupError";
	}
}

const defaultSystem: MetroSetupSystem = {
	now: () => new Date(),
	resolvePackage(projectRoot, request) {
		return createRequire(join(projectRoot, "package.json")).resolve(request);
	},
};

function parseJsonFile(path: string): Record<string, any> {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
	} catch (error) {
		throw new MetroSetupError(
			`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function dependencyNames(pkg: Record<string, any>): Set<string> {
	return new Set(
		[pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]
			.filter((value): value is Record<string, string> =>
				Boolean(value && typeof value === "object"),
			)
			.flatMap((value) => Object.keys(value)),
	);
}

function frameworkFromPackage(projectRoot: string): Framework | null {
	const packagePath = join(projectRoot, "package.json");
	if (!existsSync(packagePath)) return null;
	const names = dependencyNames(parseJsonFile(packagePath));
	if (names.has("expo")) return "expo";
	if (names.has("react-native")) return "react-native";
	return null;
}

function hasRootConfig(directory: string): boolean {
	return [...ROOT_CONFIG_NAMES, ...UNSUPPORTED_CONFIG_NAMES].some((name) =>
		existsSync(join(directory, name)),
	);
}

function discoverProjectRoot(start: string): string {
	let current = resolve(start);
	if (existsSync(current) && !statSync(current).isDirectory())
		current = dirname(current);

	while (true) {
		if (hasRootConfig(current) || frameworkFromPackage(current)) return current;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	throw new MetroSetupError(
		`Could not find an Expo or React Native app from ${resolve(start)}. ` +
			"Run this command inside the app or pass --project <directory>.",
	);
}

function explicitProjectRoot(path: string): string {
	const projectRoot = resolve(path);
	if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
		throw new MetroSetupError(
			`Project directory does not exist: ${projectRoot}`,
		);
	}
	return projectRoot;
}

function findConfig(
	projectRoot: string,
	explicitConfig?: string,
): string | null {
	if (explicitConfig) {
		const path = isAbsolute(explicitConfig)
			? explicitConfig
			: resolve(projectRoot, explicitConfig);
		if (!existsSync(path))
			throw new MetroSetupError(`Metro config does not exist: ${path}`);
		return path;
	}

	const supported = ROOT_CONFIG_NAMES.map((name) =>
		join(projectRoot, name),
	).filter(existsSync);
	const unsupported = UNSUPPORTED_CONFIG_NAMES.map((name) =>
		join(projectRoot, name),
	).filter(existsSync);
	const nested = ROOT_CONFIG_NAMES.map((name) =>
		join(projectRoot, ".config", name.replace("metro.config", "metro")),
	).filter(existsSync);
	const packagePath = join(projectRoot, "package.json");
	const hasPackageConfig =
		existsSync(packagePath) &&
		Object.hasOwn(parseJsonFile(packagePath), "metro");

	if (supported.length === 2) {
		const shim = supported.find((path) =>
			[".js", ".cjs"].includes(extname(path)),
		);
		if (shim) {
			const target = expoTypeScriptShimTarget(shim);
			if (target && supported.includes(target)) return target;
		}
	}
	if (supported.length > 1) {
		throw new MetroSetupError(
			`Multiple Metro configs were found:\n${supported.map((path) => `  - ${path}`).join("\n")}\n` +
				"Pass --config <file> to select the config intentionally.",
		);
	}
	if (supported.length === 1) return supported[0]!;

	const alternatives = [
		...unsupported,
		...nested,
		...(hasPackageConfig ? [`${packagePath}#metro`] : []),
	];
	if (alternatives.length > 0) {
		throw new MetroSetupError(
			`The detected Metro config cannot be edited safely:\n${alternatives
				.map((path) => `  - ${path}`)
				.join("\n")}\n` +
				"Move the configuration to a JavaScript or TypeScript metro.config file, then rerun setup.",
		);
	}
	return null;
}

function expoTypeScriptShimTarget(path: string): string | null {
	let program: any;
	try {
		program = parseConfig(readFileSync(path, "utf8"), path).program;
	} catch {
		return null;
	}
	const loadsTsx = (program.body as any[]).some(
		(statement) =>
			statement.type === "ExpressionStatement" &&
			requireSource(statement.expression) === "tsx/cjs",
	);
	if (!loadsTsx) return null;

	let target: ExportTarget;
	try {
		target = exportTarget(program, path);
	} catch {
		return null;
	}
	if (target.style !== "cjs") return null;
	const request = requireSource(target.expression);
	if (!request?.startsWith(".")) return null;
	const resolvedTarget = resolve(dirname(path), request);
	return [".ts", ".cts", ".mts"].includes(extname(resolvedTarget)) &&
		existsSync(resolvedTarget)
		? resolvedTarget
		: null;
}

function parseConfig(source: string, path: string): any {
	const extension = extname(path).toLowerCase();
	const plugins: any[] = ["topLevelAwait"];
	if ([".ts", ".cts", ".mts"].includes(extension)) plugins.push("typescript");

	try {
		return parse(source, {
			sourceType: "unambiguous",
			plugins,
			errorRecovery: false,
		});
	} catch (error) {
		const details = error instanceof Error ? error.message : String(error);
		throw new MetroSetupError(
			`Could not parse ${path}: ${details}\nNo files changed.`,
		);
	}
}

function isIdentifier(node: any, name?: string): boolean {
	return (
		node?.type === "Identifier" && (name === undefined || node.name === name)
	);
}

function propertyName(node: any): string | null {
	if (isIdentifier(node)) return node.name;
	if (node?.type === "StringLiteral") return node.value;
	return null;
}

function isModuleExports(node: any): boolean {
	return (
		node?.type === "MemberExpression" &&
		!node.computed &&
		isIdentifier(node.object, "module") &&
		isIdentifier(node.property, "exports")
	);
}

function unwrapExpression(node: any): any {
	let current = node;
	while (
		current &&
		[
			"TSAsExpression",
			"TSSatisfiesExpression",
			"TSTypeAssertion",
			"TypeCastExpression",
			"ParenthesizedExpression",
		].includes(current.type)
	) {
		current = current.expression;
	}
	return current;
}

function exportTarget(program: any, path: string): ExportTarget {
	const targets: ExportTarget[] = [];
	for (const statement of program.body as any[]) {
		if (
			statement.type === "ExpressionStatement" &&
			statement.expression?.type === "AssignmentExpression" &&
			statement.expression.operator === "=" &&
			isModuleExports(statement.expression.left)
		) {
			targets.push({ expression: statement.expression.right, style: "cjs" });
		}
		if (statement.type === "ExportDefaultDeclaration") {
			targets.push({ expression: statement.declaration, style: "esm" });
		}
	}

	if (targets.length !== 1) {
		throw new MetroSetupError(
			targets.length === 0
				? `Could not find one static module.exports or export default in ${path}.\nNo files changed.`
				: `Found multiple Metro exports in ${path}; select a single static export manually.\nNo files changed.`,
		);
	}
	return targets[0]!;
}

function requireSource(node: any): string | null {
	const expression = unwrapExpression(node);
	if (
		expression?.type !== "CallExpression" ||
		!isIdentifier(expression.callee, "require") ||
		expression.arguments.length !== 1 ||
		expression.arguments[0]?.type !== "StringLiteral"
	) {
		return null;
	}
	return expression.arguments[0].value;
}

function collectModuleBindings(program: any): ModuleBindings {
	const result: ModuleBindings = {
		named: new Map(),
		namespaces: new Map(),
	};

	for (const statement of program.body as any[]) {
		if (statement.type === "ImportDeclaration") {
			const source = statement.source.value as string;
			for (const specifier of statement.specifiers as any[]) {
				if (specifier.type === "ImportSpecifier") {
					const imported = propertyName(specifier.imported);
					if (imported)
						result.named.set(specifier.local.name, `${source}#${imported}`);
					if (source === AGENTSIMS_METRO && imported === "withAgentsims") {
						result.agentsimsBinding = {
							kind: "identifier",
							name: specifier.local.name,
						};
					}
				} else if (specifier.type === "ImportNamespaceSpecifier") {
					result.namespaces.set(specifier.local.name, source);
					if (source === AGENTSIMS_METRO) {
						result.agentsimsBinding = {
							kind: "namespace",
							name: specifier.local.name,
						};
					}
				}
			}
			if (source === AGENTSIMS_METRO) result.agentsimsImport = statement;
			continue;
		}

		if (statement.type !== "VariableDeclaration") continue;
		for (const declaration of statement.declarations as any[]) {
			const source = requireSource(declaration.init);
			if (!source) continue;
			if (declaration.id.type === "Identifier") {
				result.namespaces.set(declaration.id.name, source);
				if (source === AGENTSIMS_METRO) {
					result.agentsimsBinding = {
						kind: "namespace",
						name: declaration.id.name,
					};
					result.agentsimsImport = declaration;
				}
				continue;
			}
			if (declaration.id.type !== "ObjectPattern") continue;
			for (const property of declaration.id.properties as any[]) {
				if (property.type !== "ObjectProperty") continue;
				const imported = propertyName(property.key);
				const local = property.value?.name;
				if (!imported || !local) continue;
				result.named.set(local, `${source}#${imported}`);
				if (source === AGENTSIMS_METRO && imported === "withAgentsims") {
					result.agentsimsBinding = { kind: "identifier", name: local };
				}
			}
			if (source === AGENTSIMS_METRO) result.agentsimsImport = declaration;
		}
	}
	return result;
}

function calleeModuleExport(
	callee: any,
	bindings: ModuleBindings,
): string | null {
	const expression = unwrapExpression(callee);
	if (expression?.type === "Identifier")
		return bindings.named.get(expression.name) ?? null;
	if (
		expression?.type === "MemberExpression" &&
		!expression.computed &&
		expression.object?.type === "Identifier" &&
		expression.property?.type === "Identifier"
	) {
		const source = bindings.namespaces.get(expression.object.name);
		return source ? `${source}#${expression.property.name}` : null;
	}
	return null;
}

function isAgentsimsCall(node: any, bindings: ModuleBindings): boolean {
	const expression = unwrapExpression(node);
	return (
		expression?.type === "CallExpression" &&
		calleeModuleExport(expression.callee, bindings) ===
			`${AGENTSIMS_METRO}#withAgentsims`
	);
}

function hasDisabledInstrumentation(call: any): boolean {
	const options = unwrapExpression(call.arguments?.[1]);
	if (options?.type !== "ObjectExpression") return false;
	return options.properties.some(
		(property: any) =>
			property.type === "ObjectProperty" &&
			propertyName(property.key) === "instrumentBabel" &&
			property.value?.type === "BooleanLiteral" &&
			property.value.value === false,
	);
}

function containsAgentsimsCall(node: any, bindings: ModuleBindings): boolean {
	if (!node || typeof node !== "object") return false;
	if (isAgentsimsCall(node, bindings)) return true;
	for (const [key, value] of Object.entries(node)) {
		if (["loc", "start", "end", "extra"].includes(key)) continue;
		if (Array.isArray(value)) {
			if (value.some((entry) => containsAgentsimsCall(entry, bindings)))
				return true;
		} else if (containsAgentsimsCall(value, bindings)) {
			return true;
		}
	}
	return false;
}

function topLevelInitializers(program: any): Map<string, any> {
	const bindings = new Map<string, any>();
	for (const statement of program.body as any[]) {
		if (statement.type !== "VariableDeclaration" || statement.kind !== "const")
			continue;
		for (const declaration of statement.declarations as any[]) {
			if (declaration.id?.type === "Identifier" && declaration.init) {
				bindings.set(declaration.id.name, declaration.init);
			}
		}
	}
	return bindings;
}

function resolveTopLevelInitializer(
	node: any,
	initializers: Map<string, any>,
	seen = new Set<string>(),
): any {
	let expression = unwrapExpression(node);
	while (expression?.type === "Identifier") {
		if (seen.has(expression.name)) return expression;
		const initializer = initializers.get(expression.name);
		if (!initializer) return expression;
		seen.add(expression.name);
		expression = unwrapExpression(initializer);
	}
	return expression;
}

function hasExplicitTransformer(node: any): boolean {
	const expression = unwrapExpression(node);
	if (expression?.type !== "ObjectExpression") return false;
	const transformer = expression.properties.find(
		(property: any) =>
			property.type === "ObjectProperty" &&
			propertyName(property.key) === "transformer",
	);
	const transformerValue = unwrapExpression(transformer?.value);
	if (transformerValue?.type !== "ObjectExpression") return false;
	const babelPath = transformerValue.properties.find(
		(property: any) =>
			property.type === "ObjectProperty" &&
			propertyName(property.key) === "babelTransformerPath",
	);
	const value = unwrapExpression(babelPath?.value);
	return (
		value?.type === "StringLiteral" ||
		(value?.type === "CallExpression" &&
			value.callee?.type === "MemberExpression" &&
			!value.callee.computed &&
			isIdentifier(value.callee.object, "require") &&
			isIdentifier(value.callee.property, "resolve"))
	);
}

const RESOLVED_CONFIG_FACTORIES = new Set([
	"expo/metro-config#getDefaultConfig",
	"@react-native/metro-config#getDefaultConfig",
	"metro-config#getDefaultConfig",
	"@sentry/react-native/metro#getSentryExpoConfig",
]);

const CONFIG_COMBINERS = new Set([
	"@react-native/metro-config#mergeConfig",
	"metro-config#mergeConfig",
]);

const CONFIG_WRAPPERS = new Set([
	"nativewind/metro#withNativeWind",
	"nativewind/metro#withNativewind",
	"@sentry/react-native/metro#withSentryConfig",
]);

function isSynchronousMergeArgument(
	node: any,
	moduleBindings: ModuleBindings,
	initializers: Map<string, any>,
	seen: Set<string>,
): boolean {
	const expression = unwrapExpression(node);
	if (!expression || expression.type === "SpreadElement") return false;
	if (expression.type === "ObjectExpression") return true;
	if (expression.type === "Identifier") {
		if (seen.has(expression.name)) return false;
		const initializer = initializers.get(expression.name);
		if (!initializer) return false;
		const nextSeen = new Set(seen);
		nextSeen.add(expression.name);
		return isSynchronousMergeArgument(
			initializer,
			moduleBindings,
			initializers,
			nextSeen,
		);
	}
	if (expression.type !== "CallExpression") return false;
	if (
		expression.callee?.type === "ArrowFunctionExpression" ||
		expression.callee?.type === "FunctionExpression"
	) {
		return false;
	}
	const source = calleeModuleExport(expression.callee, moduleBindings);
	if (source && RESOLVED_CONFIG_FACTORIES.has(source)) return true;
	if (source && (CONFIG_COMBINERS.has(source) || CONFIG_WRAPPERS.has(source))) {
		return resolvesMetroConfig(
			expression,
			moduleBindings,
			initializers,
			new Set(seen),
		);
	}
	return false;
}

function resolvesMetroConfig(
	node: any,
	moduleBindings: ModuleBindings,
	initializers: Map<string, any>,
	seen = new Set<string>(),
): boolean {
	const expression = unwrapExpression(node);
	if (!expression) return false;
	if (expression.type === "AwaitExpression") return false;
	if (expression.type === "Identifier") {
		if (seen.has(expression.name)) return false;
		const initializer = initializers.get(expression.name);
		if (!initializer) return false;
		const nextSeen = new Set(seen);
		nextSeen.add(expression.name);
		return resolvesMetroConfig(
			initializer,
			moduleBindings,
			initializers,
			nextSeen,
		);
	}
	if (hasExplicitTransformer(expression)) return true;
	if (expression.type !== "CallExpression") return false;
	if (
		expression.callee?.type === "ArrowFunctionExpression" ||
		expression.callee?.type === "FunctionExpression"
	) {
		return false;
	}

	const source = calleeModuleExport(expression.callee, moduleBindings);
	if (!source) return false;
	if (RESOLVED_CONFIG_FACTORIES.has(source)) return true;
	if (CONFIG_COMBINERS.has(source)) {
		return (
			expression.arguments.length > 0 &&
			expression.arguments.every((argument: any) =>
				isSynchronousMergeArgument(
					argument,
					moduleBindings,
					initializers,
					new Set(seen),
				),
			) &&
			expression.arguments.some((argument: any) =>
				resolvesMetroConfig(
					argument,
					moduleBindings,
					initializers,
					new Set(seen),
				),
			)
		);
	}
	if (CONFIG_WRAPPERS.has(source)) {
		return resolvesMetroConfig(
			expression.arguments[0],
			moduleBindings,
			initializers,
			new Set(seen),
		);
	}
	return false;
}

function lineEnd(source: string, offset: number): number {
	const newline = source.indexOf("\n", offset);
	return newline === -1 ? source.length : newline + 1;
}

function preferredQuote(source: string): '"' | "'" {
	const match = source.match(/(?:require\s*\(|\bfrom\s+)(["'])/);
	return match?.[1] === "'" ? "'" : '"';
}

function newlineFor(source: string): string {
	return source.includes("\r\n") ? "\r\n" : "\n";
}

function insertionForNewImport(
	source: string,
	program: any,
	style: ModuleStyle,
): { offset: number; text: string } {
	const newline = newlineFor(source);
	const quote = preferredQuote(source);
	const declaration =
		style === "esm"
			? `import { withAgentsims } from ${quote}${AGENTSIMS_METRO}${quote};${newline}`
			: `const { withAgentsims } = require(${quote}${AGENTSIMS_METRO}${quote});${newline}`;

	let offset = program.interpreter
		? lineEnd(source, program.interpreter.end)
		: 0;
	const directives = program.directives as any[] | undefined;
	if (directives?.length)
		offset = lineEnd(source, directives[directives.length - 1]!.end);

	if (style === "esm") {
		const imports = (program.body as any[]).filter(
			(node) => node.type === "ImportDeclaration",
		);
		if (imports.length)
			offset = lineEnd(source, imports[imports.length - 1]!.end);
	} else {
		for (const statement of program.body as any[]) {
			if (statement.type !== "VariableDeclaration") break;
			const requires = statement.declarations.some((declaration: any) =>
				Boolean(requireSource(declaration.init)),
			);
			if (!requires) break;
			offset = lineEnd(source, statement.end);
		}
	}
	return { offset, text: declaration };
}

function editExistingAgentsimsImport(
	source: string,
	importNode: any,
): { edit: SourceEdit; binding: ImportBinding } {
	if (importNode.type === "ImportDeclaration") {
		const named = importNode.specifiers.filter(
			(specifier: any) => specifier.type === "ImportSpecifier",
		);
		if (named.length === 0) {
			throw new MetroSetupError(
				`An unsupported ${AGENTSIMS_METRO} import already exists. Add withAgentsims to it manually.\n` +
					"No files changed.",
			);
		}
		const last = named[named.length - 1]!;
		return {
			edit: { start: last.end, end: last.end, text: ", withAgentsims" },
			binding: { kind: "identifier", name: "withAgentsims" },
		};
	}

	if (importNode.id?.type === "ObjectPattern") {
		const properties = importNode.id.properties as any[];
		if (properties.length === 0) {
			const offset = importNode.id.start + 1;
			return {
				edit: { start: offset, end: offset, text: " withAgentsims " },
				binding: { kind: "identifier", name: "withAgentsims" },
			};
		}
		const last = properties[properties.length - 1]!;
		return {
			edit: { start: last.end, end: last.end, text: ", withAgentsims" },
			binding: { kind: "identifier", name: "withAgentsims" },
		};
	}

	throw new MetroSetupError(
		`An unsupported ${AGENTSIMS_METRO} require already exists. Add withAgentsims to it manually.\n` +
			"No files changed.",
	);
}

function bindingCall(binding: ImportBinding): string {
	return binding.kind === "identifier"
		? binding.name
		: `${binding.name}.withAgentsims`;
}

function applySourceEdits(source: string, edits: SourceEdit[]): string {
	const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
	let updated = source;
	let previousStart = source.length + 1;
	for (const edit of sorted) {
		if (edit.start < 0 || edit.end < edit.start || edit.end > source.length) {
			throw new MetroSetupError(
				"An internal setup edit was outside the Metro config bounds.",
			);
		}
		if (edit.end > previousStart) {
			throw new MetroSetupError(
				"Internal setup edits overlapped; no files changed.",
			);
		}
		updated = `${updated.slice(0, edit.start)}${edit.text}${updated.slice(edit.end)}`;
		previousStart = edit.start;
	}
	return updated;
}

export function transformMetroConfig(
	source: string,
	path: string,
): TransformedMetroConfig {
	if (Buffer.byteLength(source) > MAX_CONFIG_BYTES) {
		throw new MetroSetupError(
			`${path} is larger than ${MAX_CONFIG_BYTES / 1024} KiB and will not be edited automatically.\n` +
				"No files changed.",
		);
	}

	const ast = parseConfig(source, path);
	const program = ast.program;
	const target = exportTarget(program, path);
	const expression = unwrapExpression(target.expression);
	const moduleBindings = collectModuleBindings(program);
	const initializers = topLevelInitializers(program);
	const resolvedExpression = resolveTopLevelInitializer(
		expression,
		initializers,
	);

	if (isAgentsimsCall(resolvedExpression, moduleBindings)) {
		if (hasDisabledInstrumentation(resolvedExpression)) {
			throw new MetroSetupError(
				`${path} already calls withAgentsims with instrumentBabel: false. ` +
					"Remove that option intentionally to enable source mapping.\nNo files changed.",
			);
		}
		return { status: "already-configured", source };
	}
	if (containsAgentsimsCall(resolvedExpression, moduleBindings)) {
		throw new MetroSetupError(
			`${path} calls withAgentsims inside another Metro wrapper. ` +
				"Move it outside the final exported expression manually so existing transformers delegate correctly.\n" +
				"No files changed.",
		);
	}

	if (!resolvesMetroConfig(expression, moduleBindings, initializers)) {
		throw new MetroSetupError(
			`The exported value in ${path} is not a supported resolved Metro config. ` +
				"Automatic setup supports getDefaultConfig, mergeConfig, getSentryExpoConfig, " +
				"and static NativeWind/Sentry wrapper chains. Async configs, exported functions, " +
				"unknown factories, and plain object configs must be wrapped manually after they resolve.\n" +
				"No files changed.",
		);
	}

	if (
		typeof target.expression.start !== "number" ||
		typeof target.expression.end !== "number"
	) {
		throw new MetroSetupError(
			`Could not locate the exported value in ${path}.\nNo files changed.`,
		);
	}

	const edits: SourceEdit[] = [];
	let binding = moduleBindings.agentsimsBinding;
	if (!binding && moduleBindings.agentsimsImport) {
		const existing = editExistingAgentsimsImport(
			source,
			moduleBindings.agentsimsImport,
		);
		binding = existing.binding;
		edits.push(existing.edit);
	}
	if (!binding) {
		binding = { kind: "identifier", name: "withAgentsims" };
		const importStyle =
			target.style === "esm" ||
			(program.body as any[]).some(
				(statement) => statement.type === "ImportDeclaration",
			)
				? "esm"
				: "cjs";
		const insertion = insertionForNewImport(source, program, importStyle);
		edits.push({
			start: insertion.offset,
			end: insertion.offset,
			text: insertion.text,
		});
	}

	const call = bindingCall(binding);
	edits.push(
		{
			start: target.expression.start,
			end: target.expression.start,
			text: `${call}(`,
		},
		{ start: target.expression.end, end: target.expression.end, text: ")" },
	);
	const updated = applySourceEdits(source, edits);

	const verification = transformMetroConfig(updated, path);
	if (verification.status !== "already-configured") {
		throw new MetroSetupError(
			`Could not verify the generated Metro setup for ${path}.`,
		);
	}
	return { status: "change", source: updated };
}

function templateFor(framework: Framework): string {
	if (framework === "expo") {
		return [
			'const { getDefaultConfig } = require("expo/metro-config");',
			'const { withAgentsims } = require("agentsims/metro");',
			"",
			"const config = getDefaultConfig(__dirname);",
			"",
			"module.exports = withAgentsims(config, { projectRoot: __dirname });",
			"",
		].join("\n");
	}
	return [
		'const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config");',
		'const { withAgentsims } = require("agentsims/metro");',
		"",
		"/** @type {import('@react-native/metro-config').MetroConfig} */",
		"const config = {};",
		"",
		"module.exports = withAgentsims(",
		"  mergeConfig(getDefaultConfig(__dirname), config),",
		"  { projectRoot: __dirname },",
		");",
		"",
	].join("\n");
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function assertRegularConfig(path: string): void {
	const stat = lstatSync(path);
	if (stat.isSymbolicLink()) {
		throw new MetroSetupError(
			`Refusing to replace symlinked Metro config ${path}. Edit its target manually.\nNo files changed.`,
		);
	}
	if (!stat.isFile()) {
		throw new MetroSetupError(
			`${path} is not a regular file.\nNo files changed.`,
		);
	}
}

export function planMetroSetup(
	input: MetroSetupInput = {},
	system: MetroSetupSystem = defaultSystem,
): MetroSetupPlan {
	const start = input.cwd ?? process.cwd();
	const projectRoot = input.project
		? explicitProjectRoot(
				isAbsolute(input.project)
					? input.project
					: resolve(start, input.project),
			)
		: discoverProjectRoot(start);
	const framework = frameworkFromPackage(projectRoot);
	const configPath = findConfig(projectRoot, input.config);

	try {
		system.resolvePackage(projectRoot, AGENTSIMS_METRO);
	} catch {
		throw new MetroSetupError(
			`Cannot resolve ${AGENTSIMS_METRO} from ${projectRoot}. ` +
				"Install agentsims in this app before changing Metro configuration.\nNo files changed.",
		);
	}

	if (!configPath) {
		if (!framework) {
			throw new MetroSetupError(
				`Could not determine whether ${projectRoot} is an Expo or React Native app. ` +
					"Create a canonical Metro config manually.\nNo files changed.",
			);
		}
		return {
			projectRoot,
			configPath: join(projectRoot, "metro.config.js"),
			framework,
			original: null,
			updated: templateFor(framework),
			originalHash: null,
			status: "change",
		};
	}

	assertRegularConfig(configPath);
	const original = readFileSync(configPath, "utf8");
	const transformed = transformMetroConfig(original, configPath);
	const detectedFramework =
		framework ??
		(original.includes("expo/metro-config") ||
		original.includes("getSentryExpoConfig")
			? "expo"
			: "react-native");
	return {
		projectRoot,
		configPath,
		framework: detectedFramework,
		original,
		updated: transformed.source,
		originalHash: sha256(original),
		status: transformed.status,
	};
}

function timestamp(date: Date): string {
	return date
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z");
}

function createBackup(
	path: string,
	date: Date,
	beforeBackupCopy?: (sourcePath: string, backupPath: string) => void,
): string {
	const base = `${path}.agentsims.bak.${timestamp(date)}`;
	for (let index = 1; index < 10_000; index += 1) {
		const candidate = index === 1 ? base : `${base}.${index}`;
		beforeBackupCopy?.(path, candidate);
		try {
			copyFileSync(path, candidate, constants.COPYFILE_EXCL);
			return candidate;
		} catch (error: any) {
			if (error?.code === "EEXIST") continue;
			throw error;
		}
	}
	throw new MetroSetupError(`Could not allocate a backup path for ${path}.`);
}

function assertExpectedFileState(
	path: string,
	expectedHash: string | null | undefined,
): void {
	if (expectedHash === undefined) return;
	if (expectedHash === null) {
		if (!existsSync(path)) return;
		throw new MetroSetupError(
			`${path} changed immediately before setup could write. The config was left unchanged.`,
		);
	}
	if (!existsSync(path)) {
		throw new MetroSetupError(
			`${path} changed immediately before setup could write. The config was left unchanged.`,
		);
	}
	assertRegularConfig(path);
	if (sha256(readFileSync(path, "utf8")) !== expectedHash) {
		throw new MetroSetupError(
			`${path} changed immediately before setup could write. The config was left unchanged.`,
		);
	}
}

function atomicWrite(
	path: string,
	contents: string,
	mode: number,
	expectedHash?: string | null,
	beforeRename?: (path: string) => void,
): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = join(
		dirname(path),
		`.${basename(path)}.agentsims-${process.pid}-${randomUUID()}.tmp`,
	);
	let descriptor: number | null = null;
	try {
		descriptor = openSync(temporary, "wx", mode);
		writeFileSync(descriptor, contents, "utf8");
		fchmodSync(descriptor, mode);
		fsyncSync(descriptor);
		closeSync(descriptor);
		descriptor = null;
		beforeRename?.(path);
		// This guards the practical window after the replacement is durable but
		// before rename. A non-cooperative writer can still race the rename itself.
		assertExpectedFileState(path, expectedHash);
		renameSync(temporary, path);
	} catch (error) {
		if (descriptor !== null) closeSync(descriptor);
		if (existsSync(temporary)) unlinkSync(temporary);
		throw error;
	}
}

function verifyWrittenConfig(path: string): void {
	const written = readFileSync(path, "utf8");
	const transformed = transformMetroConfig(written, path);
	if (transformed.status !== "already-configured") {
		throw new MetroSetupError(
			`The written Metro config did not pass setup verification: ${path}`,
		);
	}
}

export function applyMetroSetup(
	plan: MetroSetupPlan,
	system: MetroSetupSystem = defaultSystem,
): AppliedMetroSetup {
	if (plan.status === "already-configured") {
		return { configPath: plan.configPath, backupPath: null, created: false };
	}

	const existed = plan.original !== null;
	if (existed) {
		if (!existsSync(plan.configPath)) {
			throw new MetroSetupError(
				`${plan.configPath} changed after setup was planned. No files changed.`,
			);
		}
		assertRegularConfig(plan.configPath);
		const current = readFileSync(plan.configPath, "utf8");
		if (sha256(current) !== plan.originalHash) {
			throw new MetroSetupError(
				`${plan.configPath} changed after setup was planned. No files changed.`,
			);
		}
	} else if (existsSync(plan.configPath)) {
		throw new MetroSetupError(
			`${plan.configPath} was created after setup was planned. No files changed.`,
		);
	}

	const mode = existed ? statSync(plan.configPath).mode & 0o777 : 0o644;
	const backupPath = existed
		? createBackup(plan.configPath, system.now(), system.beforeBackupCopy)
		: null;
	if (backupPath) {
		const currentAfterBackup = readFileSync(plan.configPath, "utf8");
		if (sha256(currentAfterBackup) !== plan.originalHash) {
			unlinkSync(backupPath);
			throw new MetroSetupError(
				`${plan.configPath} changed while its backup was being created. No files changed.`,
			);
		}
	}

	let wroteConfig = false;
	try {
		atomicWrite(
			plan.configPath,
			plan.updated,
			mode,
			plan.originalHash,
			system.beforeAtomicRename,
		);
		wroteConfig = true;
		verifyWrittenConfig(plan.configPath);
	} catch (error) {
		if (!wroteConfig) throw error;
		let rollbackError: unknown;
		try {
			if (backupPath) {
				atomicWrite(
					plan.configPath,
					readFileSync(backupPath, "utf8"),
					mode,
					sha256(plan.updated),
				);
			} else if (existsSync(plan.configPath)) {
				if (
					sha256(readFileSync(plan.configPath, "utf8")) !== sha256(plan.updated)
				) {
					throw new MetroSetupError(
						`${plan.configPath} changed after setup wrote it; refusing to remove a concurrent config.`,
					);
				}
				unlinkSync(plan.configPath);
			}
		} catch (caught) {
			rollbackError = caught;
		}
		const details = error instanceof Error ? error.message : String(error);
		if (rollbackError) {
			throw new MetroSetupError(
				`Setup failed (${details}) and rollback also failed: ${
					rollbackError instanceof Error
						? rollbackError.message
						: String(rollbackError)
				}. Restore ${backupPath ?? "the original config"} manually.`,
			);
		}
		throw new MetroSetupError(`Setup failed and was rolled back: ${details}`);
	}

	return { configPath: plan.configPath, backupPath, created: !existed };
}

function normalizedLines(value: string): string[] {
	const normalized = value.replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

export function formatMetroSetupDiff(plan: MetroSetupPlan): string {
	if (plan.status === "already-configured") return "";
	const before = normalizedLines(plan.original ?? "");
	const after = normalizedLines(plan.updated);
	const oldLabel = plan.original === null ? "/dev/null" : plan.configPath;
	const oldStart = before.length === 0 ? 0 : 1;
	const newStart = after.length === 0 ? 0 : 1;
	return [
		`--- ${oldLabel}`,
		`+++ ${plan.configPath}`,
		`@@ -${oldStart},${before.length} +${newStart},${after.length} @@`,
		...before.map((line) => `-${line}`),
		...after.map((line) => `+${line}`),
	].join("\n");
}
