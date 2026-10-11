import defaultMdxComponents from "fumadocs-ui/mdx";
import type { ComponentProps } from "react";
import { resolveDocsHref } from "../../docs/links";
import { CodeBlock } from "./code-block";

const DefaultLink = defaultMdxComponents.a;

function DocsLink({ href = "", ...props }: ComponentProps<"a">) {
	return <DefaultLink href={resolveDocsHref(href)} {...props} />;
}

export const mdxComponents = {
	...defaultMdxComponents,
	a: DocsLink,
	pre: CodeBlock,
};
