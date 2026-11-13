"use client"

/**
 * The agent2go answer catalog (docs/a2ui/answer-catalog.json) implemented with Astryx components, for the official
 * A2UI v1.0 renderer (`@a2ui/web_core` processes messages, data binding, checks and actions; `@a2ui/react` renders).
 *
 * The catalog is the allow-list: a surface may only use these components and functions. Text is always plain text
 * (React escapes it; no Markdown, HTML, images, media or links), and no function opens a URL or calls the agent.
 * Loaded lazily with the first surface, so a chat without one never downloads the renderer.
 */

import * as React from "react"
import { z } from "zod"
import { createComponentImplementation, type ReactCatalogComponent } from "@a2ui/react"
import {
  AccessibilityAttributesSchema,
  ActionSchema,
  BASIC_FUNCTIONS,
  Catalog,
  CheckableSchema,
  ChildListSchema,
  ComponentIdSchema,
  DynamicStringListSchema,
  DynamicStringSchema,
  DynamicValueSchema,
  createFunctionImplementation,
} from "@a2ui/web_core/v1_0"
import { Button } from "@astryxdesign/core/Button"
import type { ISODateString } from "@astryxdesign/core/Calendar"
import { Card } from "@astryxdesign/core/Card"
import { Collapsible } from "@astryxdesign/core/Collapsible"
import { DateInput } from "@astryxdesign/core/DateInput"
import { Grid } from "@astryxdesign/core/Grid"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList"
import { Selector } from "@astryxdesign/core/Selector"
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@astryxdesign/core/Table"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import { ANSWER_CATALOG_ID, FUNCTIONS } from "./protocol"

/** What the chat tells every surface: whether it may act now, and whether the answer running is the one it asked for. */
export interface SurfaceState {
  disabled: boolean
  submitting: boolean
}
export const SurfaceStateContext = React.createContext<SurfaceState>({ disabled: false, submitting: false })

/** A Form's submit handler and the validity of the fields inside it. */
interface FormState {
  setSubmit: (submit: (() => void) | null) => void
  report: (id: string, valid: boolean) => void
  attempted: boolean
}
const FormContext = React.createContext<FormState | null>(null)

type A11y = { label?: unknown; description?: unknown; live?: unknown; hidden?: unknown } | undefined

/** v1.0 `@accessibility` mapped to ARIA; explicit attributes override what the component infers (spec: MUST plumb). */
function aria(a11y: A11y): React.AriaAttributes {
  if (!a11y) return {}
  return {
    ...(typeof a11y.label === "string" && a11y.label ? { "aria-label": a11y.label } : {}),
    ...(typeof a11y.description === "string" && a11y.description ? { "aria-description": a11y.description } : {}),
    ...(a11y.live === "polite" || a11y.live === "assertive" || a11y.live === "off" ? { "aria-live": a11y.live } : {}),
    ...(a11y.hidden === true ? { "aria-hidden": true } : {}),
  }
}

const text = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "")
const isIsoDate = (value: unknown): value is ISODateString => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
const childIds = (children: unknown): { id: string; basePath?: string }[] =>
  Array.isArray(children)
    ? children.flatMap((c) => (typeof c === "string" ? [{ id: c }] : c && typeof c === "object" && "id" in c ? [c as { id: string; basePath: string }] : []))
    : []

const Accessible = { accessibility: AccessibilityAttributesSchema.optional() }
/**
 * The v1.0 `@checks` rules (renamed `checks` for the SDK by `adaptForSdk`). Composed as a field, never by extending
 * `CheckableSchema`: that would copy its `REF:Checkable` description onto the whole component, and the SDK's binder,
 * which reads those descriptions, would then treat every property as static and never bind or check anything.
 */
const Checks = { checks: CheckableSchema.shape.checks }

// -- layout --------------------------------------------------------------------------------------------
const CardImpl = createComponentImplementation(
  { name: "Card", schema: z.object({ child: ComponentIdSchema, ...Accessible }).strict() },
  ({ props, buildChild }) => (
    <Card padding={3} {...aria(props.accessibility as A11y)} data-testid="a2ui-card">
      {buildChild(props.child as string)}
    </Card>
  ),
)

const ColumnImpl = createComponentImplementation(
  { name: "Column", schema: z.object({ children: ChildListSchema, ...Accessible }).strict() },
  ({ props, buildChild }) => (
    <VStack gap={2} className="min-w-0" {...aria(props.accessibility as A11y)}>
      {childIds(props.children).map((c) => (
        <React.Fragment key={`${c.id}:${c.basePath ?? ""}`}>{buildChild(c.id, c.basePath)}</React.Fragment>
      ))}
    </VStack>
  ),
)

const RowImpl = createComponentImplementation(
  { name: "Row", schema: z.object({ children: ChildListSchema, ...Accessible }).strict() },
  ({ props, buildChild }) => (
    // Side by side while the container is wide enough, stacked below that: the chat panel can be phone-narrow.
    <Grid columns={{ minWidth: 176, repeat: "fit" }} columnGap={3} rowGap={2} align="start" {...aria(props.accessibility as A11y)}>
      {childIds(props.children).map((c) => (
        <React.Fragment key={`${c.id}:${c.basePath ?? ""}`}>{buildChild(c.id, c.basePath)}</React.Fragment>
      ))}
    </Grid>
  ),
)

const TextImpl = createComponentImplementation(
  {
    name: "Text",
    schema: z.object({ text: DynamicStringSchema, variant: z.enum(["title", "body", "caption"]).optional(), ...Accessible }).strict(),
  },
  ({ props }) => {
    const value = text(props.text)
    if (props.variant === "title") return <Heading level={4} {...aria(props.accessibility as A11y)}>{value}</Heading>
    return (
      <Text as="p" type={props.variant === "caption" ? "supporting" : undefined} {...aria(props.accessibility as A11y)}>
        {value}
      </Text>
    )
  },
)

// -- data ----------------------------------------------------------------------------------------------
const ColumnSchema = z.object({ key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,31}$/), label: z.string().max(40), numeric: z.boolean().optional() }).strict()
const MAX_ROWS = 24

const TableImpl = createComponentImplementation(
  {
    name: "Table",
    schema: z.object({ caption: DynamicStringSchema, columns: z.array(ColumnSchema).min(1).max(6), rows: DynamicValueSchema, ...Accessible }).strict(),
  },
  ({ props }) => {
    const captionId = React.useId()
    const columns = props.columns as z.infer<typeof ColumnSchema>[]
    // The rows come from the data model: only plain objects, only text or numbers, at most MAX_ROWS.
    const rows = (Array.isArray(props.rows) ? props.rows : [])
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r))
      .slice(0, MAX_ROWS)
    const cell = (value: unknown) => (typeof value === "number" ? value.toLocaleString("en-US") : text(value))
    return (
      // Its own focusable, named scroll region, so a narrow chat panel scrolls the table, never the page.
      <VStack
        role="region"
        tabIndex={0}
        aria-labelledby={captionId}
        isScrollable
        className="max-w-full rounded-lg border border-border"
        data-testid="a2ui-table"
        data-layout-ok="overlap"
        {...aria(props.accessibility as A11y)}
      >
        <Table density="compact" verticalAlign="top" aria-labelledby={captionId} style={{ minWidth: "24rem" }}>
          <caption id={captionId} className="sr-only">{text(props.caption)}</caption>
          <TableHeader>
            <TableRow isHeaderRow>
              {columns.map((c) => (
                <TableHeaderCell key={c.key} scope="col" className={c.numeric ? "text-right" : undefined}>
                  {c.label}
                </TableHeaderCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={i} data-testid="a2ui-table-row">
                {columns.map((c, j) =>
                  j === 0 ? (
                    <TableCell key={c.key} scope="row" role="rowheader" className="sticky left-0 min-w-36 bg-card">
                      <Text weight="medium">{cell(row[c.key])}</Text>
                    </TableCell>
                  ) : (
                    <TableCell key={c.key} data-column={c.key} className={c.numeric ? "min-w-20 text-right tabular-nums" : "min-w-24"}>
                      {cell(row[c.key])}
                    </TableCell>
                  ),
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </VStack>
    )
  },
)

// -- forms ---------------------------------------------------------------------------------------------
const FormImpl = createComponentImplementation(
  {
    name: "Form",
    schema: z.object({ title: DynamicStringSchema, description: DynamicStringSchema.optional(), children: ChildListSchema, ...Accessible }).strict(),
  },
  ({ props, buildChild }) => {
    const titleId = React.useId()
    const submit = React.useRef<(() => void) | null>(null)
    const invalid = React.useRef(new Set<string>())
    const formRef = React.useRef<HTMLFormElement>(null)
    const [attempted, setAttempted] = React.useState(false)
    const state = React.useMemo<FormState>(
      () => ({
        setSubmit: (fn) => {
          submit.current = fn
        },
        report: (id, valid) => {
          if (valid) invalid.current.delete(id)
          else invalid.current.add(id)
        },
        attempted,
      }),
      [attempted],
    )
    const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      // A field can be invalid by the surface's checks or by its own constraint (a typed date outside min/max never
      // reaches the data model, so only the field knows); either one stops the submit.
      const fieldInvalid = formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")
      if (invalid.current.size > 0 || fieldInvalid) {
        // Let people submit, then show what to fix and take them to the first field that needs it.
        setAttempted(true)
        requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus())
        return
      }
      submit.current?.()
    }
    return (
      <Collapsible
        defaultIsOpen={false}
        chevronPosition="end"
        data-testid="a2ui-form"
        trigger={
          <VStack as="span" gap={0} className="min-w-0 text-start">
            <Text id={titleId} weight="semibold">{text(props.title)}</Text>
            {props.description ? <Text type="supporting">{text(props.description)}</Text> : null}
          </VStack>
        }
      >
        <search>
          <form ref={formRef} aria-labelledby={titleId} noValidate onSubmit={onSubmit} {...aria(props.accessibility as A11y)}>
            <FormContext.Provider value={state}>
              <VStack gap={3} paddingBlock={2}>
                {childIds(props.children).map((c) => (
                  <React.Fragment key={`${c.id}:${c.basePath ?? ""}`}>{buildChild(c.id, c.basePath)}</React.Fragment>
                ))}
              </VStack>
            </FormContext.Provider>
          </form>
        </search>
      </Collapsible>
    )
  },
)

/** A field's check results, shown once the person has changed it or tried to submit (never while they type). */
function useFieldStatus(id: string, isValid: unknown, errors: unknown, touched: boolean) {
  const form = React.useContext(FormContext)
  const valid = isValid !== false
  React.useEffect(() => {
    form?.report(id, valid)
    return () => form?.report(id, true)
  }, [form, id, valid])
  const message = Array.isArray(errors) ? errors.filter((e): e is string => typeof e === "string").join(" ") : ""
  return !valid && (touched || form?.attempted) ? { type: "error" as const, message: message || "Check this field." } : undefined
}

const PickerSchema = z.object({
  ...Checks,
  label: DynamicStringSchema,
  variant: z.literal("mutuallyExclusive").optional(),
  options: z.array(z.object({ label: DynamicStringSchema, value: z.string().max(64) }).strict()).min(1).max(31),
  value: DynamicStringListSchema,
  ...Accessible,
}).strict()

const ChoicePickerImpl = createComponentImplementation({ name: "ChoicePicker", schema: PickerSchema }, ({ props, context }) => {
  const { disabled } = React.useContext(SurfaceStateContext)
  const [touched, setTouched] = React.useState(false)
  const status = useFieldStatus(context.componentModel.id, props.isValid, props.validationErrors, touched)
  const options = (props.options as { label: unknown; value: string }[]).map((o) => ({ value: o.value, label: text(o.label) || o.value }))
  const selected = Array.isArray(props.value) && typeof props.value[0] === "string" ? props.value[0] : ""
  const choose = (value: string | null) => {
    setTouched(true)
    props.setValue?.(value ? [value] : [])
  }
  const label = text(props.label)
  // Up to five options stay visible as radios; a longer list (territories) becomes a menu.
  return options.length <= 5 ? (
    <RadioList label={label} value={selected} onChange={choose} isDisabled={disabled} status={status} size="md" {...aria(props.accessibility as A11y)}>
      {options.map((o) => (
        <RadioListItem key={o.value} value={o.value} label={o.label} />
      ))}
    </RadioList>
  ) : (
    <Selector label={label} options={options} value={selected} onChange={choose} isDisabled={disabled} status={status} width="100%" presentation="adaptive" />
  )
})

const DateSchema = z.object({
  ...Checks,
  label: DynamicStringSchema,
  value: DynamicStringSchema,
  enableDate: z.literal(true),
  min: DynamicStringSchema.optional(),
  max: DynamicStringSchema.optional(),
  ...Accessible,
}).strict()

const DateTimeInputImpl = createComponentImplementation({ name: "DateTimeInput", schema: DateSchema }, ({ props, context }) => {
  const { disabled } = React.useContext(SurfaceStateContext)
  const [touched, setTouched] = React.useState(false)
  const status = useFieldStatus(context.componentModel.id, props.isValid, props.validationErrors, touched)
  return (
    <DateInput
      label={text(props.label)}
      width="100%"
      value={isIsoDate(props.value) ? props.value : undefined}
      min={isIsoDate(props.min) ? props.min : undefined}
      max={isIsoDate(props.max) ? props.max : undefined}
      format="system_date"
      isDisabled={disabled}
      status={status}
      statusVariant="detached"
      onChange={(next) => {
        setTouched(true)
        props.setValue?.(next ?? "")
      }}
    />
  )
})

const ButtonImpl = createComponentImplementation(
  {
    name: "Button",
    schema: z.object({ ...Checks, label: DynamicStringSchema, variant: z.enum(["primary", "default"]).optional(), action: ActionSchema, ...Accessible }).strict(),
  },
  ({ props }) => {
    const { disabled, submitting } = React.useContext(SurfaceStateContext)
    const form = React.useContext(FormContext)
    const submits = form !== null && props.variant === "primary"
    const blocked = disabled || props.isValid === false
    const fire = React.useCallback(() => {
      if (!blocked && typeof props.action === "function") void props.action()
    }, [blocked, props])
    React.useEffect(() => {
      if (!submits) return
      form.setSubmit(fire)
      return () => form.setSubmit(null)
    }, [form, submits, fire])
    return (
      <HStack hAlign="start">
        <Button
          label={text(props.label)}
          variant={props.variant === "primary" ? "primary" : "secondary"}
          type={submits ? "submit" : "button"}
          // While any answer runs nothing can be sent, so one press is one question (never a double post); the
          // button that asked shows progress until its answer arrives.
          isLoading={submitting}
          isDisabled={blocked && !submitting}
          onClick={submits ? undefined : fire}
          data-testid="a2ui-button"
          {...aria(props.accessibility as A11y)}
        />
      </HStack>
    )
  },
)

// -- functions -----------------------------------------------------------------------------------------
const isOnOrBefore = createFunctionImplementation(
  {
    name: "isOnOrBefore",
    returnType: "boolean",
    schema: z.object({ value: z.unknown(), limit: z.unknown() }),
    allowedCallers: "rendererOnly",
    description: "True when the ISO date in value is on or before the ISO date in limit, or either is empty.",
  },
  ({ value, limit }) => !isIsoDate(value) || !isIsoDate(limit) || value <= limit,
)

/** The basic catalog's own implementations of the functions we allow, plus `isOnOrBefore`. Nothing else is callable. */
export const ANSWER_FUNCTIONS = [...BASIC_FUNCTIONS.filter((f) => FUNCTIONS.includes(f.name)), isOnOrBefore]

export const ANSWER_COMPONENTS: ReactCatalogComponent[] = [
  CardImpl,
  ColumnImpl,
  RowImpl,
  TextImpl,
  TableImpl,
  FormImpl,
  ChoicePickerImpl,
  DateTimeInputImpl,
  ButtonImpl,
]

export const answerCatalog = new Catalog<ReactCatalogComponent>(ANSWER_CATALOG_ID, "1.0", ANSWER_COMPONENTS, ANSWER_FUNCTIONS)
