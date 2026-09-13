import { createHash } from "crypto";
import { appendFileSync, mkdirSync } from "fs";
import { dirname, relative, resolve } from "path";
import { homedir } from "os";

const HOST_COMPONENTS = new Set([
	"ActivityIndicator",
	"Button",
	"FlatList",
	"Image",
	"ImageBackground",
	"KeyboardAvoidingView",
	"Modal",
	"Pressable",
	"RefreshControl",
	"SafeAreaView",
	"ScrollView",
	"SectionList",
	"Switch",
	"Text",
	"TextInput",
	"TouchableHighlight",
	"TouchableNativeFeedback",
	"TouchableOpacity",
	"TouchableWithoutFeedback",
	"View",
	"VirtualizedList",
]);

const DEFAULT_MANIFEST = `${homedir()}/.agentsims/rn-source-map.jsonl`;
const SAFE_PROP_NAMES = new Set([
	"accessibilityHint",
	"accessibilityLabel",
	"accessibilityRole",
	"disabled",
	"editable",
	"nativeID",
	"placeholder",
	"role",
	"testID",
]);

type BabelApi = { types: any };
type BabelPath = {
	node: any;
	parentPath?: BabelPath | null;
	get?: (name: string) => BabelPath | BabelPath[];
	isFunctionDeclaration?: () => boolean;
	isFunctionExpression?: () => boolean;
	isArrowFunctionExpression?: () => boolean;
	isClassDeclaration?: () => boolean;
	isVariableDeclarator?: () => boolean;
};

type InstrumentableElement =
	| { kind: "host"; name: string; tag: string }
	| { kind: "custom"; name: string; tag: string };

type TestIDAttribute =
	| { kind: "missing" }
	| { kind: "static"; value: string }
	| { kind: "dynamic" };

function hash(input: string): string {
	return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function manifestPath(): string {
	return process.env.AGENTSIMS_RN_MANIFEST || DEFAULT_MANIFEST;
}

function projectRoot(state: any): string {
	return (
		process.env.AGENTSIMS_PROJECT_ROOT ||
		state.file?.opts?.root ||
		process.cwd()
	);
}

function projectKey(root: string): string {
	return hash(resolve(root).replace(/\\/g, "/"));
}

function tagName(node: any): string | null {
	if (!node) return null;
	if (node.type === "JSXIdentifier") return node.name;
	if (node.type === "JSXMemberExpression") {
		const object = tagName(node.object);
		const property = tagName(node.property);
		return object && property ? `${object}.${property}` : property;
	}
	return null;
}

function attrName(attr: any): string | null {
	return attr?.name?.type === "JSXIdentifier" ? attr.name.name : null;
}

function findAttribute(opening: any, name: string): any | null {
	return (
		opening.attributes.find((attr: any) => attrName(attr) === name) ?? null
	);
}

function testIDAttribute(attr: any | null): TestIDAttribute {
	if (!attr) return { kind: "missing" };
	if (attr.value?.type === "StringLiteral") {
		return { kind: "static", value: attr.value.value };
	}
	if (attr.value?.type !== "JSXExpressionContainer") return { kind: "dynamic" };

	const expression = attr.value.expression;
	if (expression?.type === "StringLiteral") {
		return { kind: "static", value: expression.value };
	}
	if (
		expression?.type === "TemplateLiteral" &&
		expression.expressions?.length === 0
	) {
		const value =
			expression.quasis?.[0]?.value?.cooked ??
			expression.quasis?.[0]?.value?.raw;
		if (typeof value === "string") return { kind: "static", value };
	}
	return { kind: "dynamic" };
}

function reactNativeBindings(program: any): {
	hosts: Map<string, string>;
	namespaces: Set<string>;
} {
	const hosts = new Map<string, string>();
	const namespaces = new Set<string>();

	for (const statement of program?.body ?? []) {
		if (
			statement.type === "ImportDeclaration" &&
			statement.source?.value === "react-native"
		) {
			for (const specifier of statement.specifiers ?? []) {
				if (
					specifier.type === "ImportNamespaceSpecifier" ||
					specifier.type === "ImportDefaultSpecifier"
				) {
					if (specifier.local?.name) namespaces.add(specifier.local.name);
					continue;
				}
				if (specifier.type !== "ImportSpecifier" || !specifier.local?.name)
					continue;
				const imported = specifier.imported?.name ?? specifier.imported?.value;
				if (typeof imported === "string" && HOST_COMPONENTS.has(imported)) {
					hosts.set(specifier.local.name, imported);
				}
			}
			continue;
		}

		if (statement.type !== "VariableDeclaration") continue;
		for (const declaration of statement.declarations ?? []) {
			const init = declaration.init;
			const isReactNativeRequire =
				init?.type === "CallExpression" &&
				init.callee?.type === "Identifier" &&
				init.callee.name === "require" &&
				init.arguments?.[0]?.type === "StringLiteral" &&
				init.arguments[0].value === "react-native";
			if (!isReactNativeRequire) continue;

			if (declaration.id?.type === "Identifier") {
				namespaces.add(declaration.id.name);
				continue;
			}
			if (declaration.id?.type !== "ObjectPattern") continue;
			for (const property of declaration.id.properties ?? []) {
				if (property.type !== "ObjectProperty") continue;
				const imported = property.key?.name ?? property.key?.value;
				const local = property.value?.name;
				if (
					typeof imported === "string" &&
					typeof local === "string" &&
					HOST_COMPONENTS.has(imported)
				) {
					hosts.set(local, imported);
				}
			}
		}
	}

	return { hosts, namespaces };
}

function instrumentableElement(
	opening: any,
	state: any,
): InstrumentableElement | null {
	const name = tagName(opening.name);
	if (!name || name === "Fragment" || name === "React.Fragment") return null;

	const bindings = state.__agentsimsReactNativeBindings as
		| ReturnType<typeof reactNativeBindings>
		| undefined;
	const directHost = bindings?.hosts.get(name);
	if (directHost) return { kind: "host", name, tag: directHost };

	const dot = name.indexOf(".");
	if (dot > 0 && bindings?.namespaces.has(name.slice(0, dot))) {
		const member = name.slice(name.lastIndexOf(".") + 1);
		if (HOST_COMPONENTS.has(member)) return { kind: "host", name, tag: member };
	}

	const rootName = dot >= 0 ? name.slice(0, dot) : name;
	if (!/^[A-Z]/.test(rootName)) return null;
	return { kind: "custom", name, tag: name };
}

function insertGeneratedTestID(opening: any, attribute: any): void {
	const firstSpread = opening.attributes.findIndex(
		(attr: any) => attr.type === "JSXSpreadAttribute",
	);
	const index = firstSpread >= 0 ? firstSpread : opening.attributes.length;
	opening.attributes.splice(index, 0, attribute);
}

function componentStack(path: BabelPath): string[] {
	const names: string[] = [];
	let current: BabelPath | null | undefined = path.parentPath;
	while (current) {
		const node = current.node;
		let name: string | undefined;
		if (current.isFunctionDeclaration?.() && node.id?.name) name = node.id.name;
		if (current.isClassDeclaration?.() && node.id?.name) name = node.id.name;
		if (
			(current.isFunctionExpression?.() ||
				current.isArrowFunctionExpression?.()) &&
			current.parentPath?.isVariableDeclarator?.()
		) {
			const id = current.parentPath.node.id;
			if (id?.type === "Identifier") name = id.name;
		}
		if (name && names[names.length - 1] !== name) names.push(name);
		current = current.parentPath;
	}
	return names.reverse();
}

function literalAttributeValue(
	attr: any,
): string | number | boolean | null | undefined {
	if (!attr?.value) return true;
	if (attr.value.type === "StringLiteral") return attr.value.value;
	const expression =
		attr.value.type === "JSXExpressionContainer" ? attr.value.expression : null;
	if (!expression) return undefined;
	if (
		expression.type === "StringLiteral" ||
		expression.type === "NumericLiteral" ||
		expression.type === "BooleanLiteral"
	) {
		return expression.value;
	}
	if (expression.type === "NullLiteral") return null;
	return undefined;
}

function safeLiteralProps(
	opening: any,
): Record<string, string | number | boolean | null> | undefined {
	const props: Record<string, string | number | boolean | null> = {};
	for (const attr of opening.attributes) {
		const name = attrName(attr);
		if (!name || !SAFE_PROP_NAMES.has(name)) continue;
		const value = literalAttributeValue(attr);
		if (value !== undefined) props[name] = value;
	}
	return Object.keys(props).length > 0 ? props : undefined;
}

function directVisibleText(path: BabelPath): string | undefined {
	const parent = path.parentPath?.node;
	if (parent?.type !== "JSXElement" || !Array.isArray(parent.children))
		return undefined;
	const text = parent.children
		.flatMap((child: any) => {
			if (child.type === "JSXText") return [child.value];
			if (
				child.type === "JSXExpressionContainer" &&
				child.expression?.type === "StringLiteral"
			) {
				return [child.expression.value];
			}
			return [];
		})
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	return text || undefined;
}

export function expoRoute(file: string): string | undefined {
	const normalized = file.replace(/\\/g, "/");
	const match = normalized.match(/(?:^|\/)app\/(.+)\.[cm]?[jt]sx?$/);
	if (!match) return undefined;
	const segments = match[1]!
		.split("/")
		.filter((segment) => !/^\(.+\)$/.test(segment) && segment !== "_layout")
		.map((segment) => (segment === "index" ? "" : segment));
	const route = `/${segments.filter(Boolean).join("/")}`;
	return route || "/";
}

function writeRecords(records: unknown[]): void {
	if (records.length === 0) return;
	const path = manifestPath();
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(
		path,
		records.map((record) => JSON.stringify(record)).join("\n") + "\n",
	);
}

export default function agentsimsReactNativeBabelPlugin({
	types: t,
}: BabelApi) {
	return {
		name: "agentsims-react-native-source",
		visitor: {
			Program: {
				enter(path: BabelPath, state: any) {
					state.__agentsimsRecords = [];
					state.__agentsimsReactNativeBindings = reactNativeBindings(path.node);
				},
				exit(_path: BabelPath, state: any) {
					writeRecords(state.__agentsimsRecords ?? []);
				},
			},
			JSXOpeningElement(path: BabelPath, state: any) {
				const filename = state.file?.opts?.filename;
				if (!filename || /[/\\]node_modules[/\\]/.test(filename)) return;

				const opening = path.node;
				const element = instrumentableElement(opening, state);
				if (!element || !opening.loc?.start) return;

				const existingTestId = findAttribute(opening, "testID");
				const explicitTestID = testIDAttribute(existingTestId);
				if (explicitTestID.kind === "dynamic") return;

				const root = projectRoot(state);
				const rootKey = projectKey(root);
				const rel = relative(root, filename) || filename;
				const loc = opening.loc.start;
				const generated = `ags_${rootKey}_${hash(`${rel}:${loc.line}:${loc.column}:${element.name}`)}`;
				const testID =
					explicitTestID.kind === "static" ? explicitTestID.value : generated;
				if (!testID) return;
				const injected =
					explicitTestID.kind === "missing" ||
					(explicitTestID.kind === "static" &&
						explicitTestID.value === generated);
				const owners = componentStack(path);

				if (explicitTestID.kind === "missing") {
					insertGeneratedTestID(
						opening,
						t.jsxAttribute(t.jsxIdentifier("testID"), t.stringLiteral(testID)),
					);
				}

				const ownerStack =
					element.kind === "custom" &&
					owners[owners.length - 1] !== element.name
						? [...owners, element.name]
						: owners;
				state.__agentsimsRecords.push({
					testID,
					tag: element.tag,
					elementKind: element.kind,
					testIDSource: injected ? "generated" : "static",
					projectKey: rootKey,
					file: rel,
					absoluteFile: filename,
					line: loc.line,
					column: loc.column,
					componentName:
						element.kind === "custom"
							? element.name
							: owners[owners.length - 1],
					ownerStack,
					route: expoRoute(rel),
					visibleText: directVisibleText(path),
					props: safeLiteralProps(opening),
					injected,
				});
			},
		},
	};
}
