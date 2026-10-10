import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const noEventCurrentTargetInStateUpdater = {
  meta: {
    type: "problem",
    docs: {
      description: "Prevent reading event.currentTarget inside deferred state updaters",
    },
    schema: [],
    messages: {
      captureCurrentTarget:
        "Capture event.currentTarget values before passing a functional updater to a state setter; currentTarget is not reliable after the event handler returns.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const reportedNodes = new WeakSet();

    const walk = (node) => {
      if (!node || typeof node !== "object" || typeof node.type !== "string") return;
      if (
        node.type === "MemberExpression" &&
        !node.computed &&
        node.property?.type === "Identifier" &&
        node.property.name === "currentTarget" &&
        !reportedNodes.has(node)
      ) {
        reportedNodes.add(node);
        context.report({ node, messageId: "captureCurrentTarget" });
      }

      for (const key of sourceCode.visitorKeys[node.type] ?? []) {
        const child = node[key];
        if (Array.isArray(child)) {
          child.forEach(walk);
        } else {
          walk(child);
        }
      }
    };

    return {
      CallExpression(node) {
        if (
          node.callee?.type !== "Identifier" ||
          !/^set[A-Z]/.test(node.callee.name)
        ) {
          return;
        }
        const updater = node.arguments[0];
        if (
          updater?.type === "ArrowFunctionExpression" ||
          updater?.type === "FunctionExpression"
        ) {
          walk(updater);
        }
      },
    };
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: {
      "huswell-safety": {
        rules: {
          "no-event-current-target-in-state-updater": noEventCurrentTargetInStateUpdater,
        },
      },
    },
    rules: {
      "huswell-safety/no-event-current-target-in-state-updater": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
