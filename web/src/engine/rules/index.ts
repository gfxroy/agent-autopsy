import { contextBloatRule, contextOverflowRule } from './context'
import { noFinalAnswerRule, truncatedRule } from './ending'
import { injectionRule } from './injection'
import { invalidArgsRule } from './invalidArgs'
import { loopRule } from './loop'
import { handoffRule, unusedToolsRule } from './misc'
import { expensiveStepRule, slowStepRule } from './perf'
import { toolErrorRule } from './toolError'
import type { Rule } from './types'
import { unknownToolRule } from './unknownTool'

export const RULES: Rule[] = [
  injectionRule,
  loopRule,
  unknownToolRule,
  invalidArgsRule,
  toolErrorRule,
  handoffRule,
  noFinalAnswerRule,
  truncatedRule,
  contextOverflowRule,
  contextBloatRule,
  slowStepRule,
  expensiveStepRule,
  unusedToolsRule,
]
export type { Rule }
