import { Card } from "@astryxdesign/core/Card"
import { Heading } from "@astryxdesign/core/Heading"
import { HStack } from "@astryxdesign/core/HStack"
import { Icon, type IconProps } from "@astryxdesign/core/Icon"
import { Text } from "@astryxdesign/core/Text"
import { VStack } from "@astryxdesign/core/VStack"
import * as React from "react"

/**
 * A titled block on an administrator page: an Astryx Card with an `h2`, a sentence under it, optional end content
 * (badges, a refresh button) and the body. The `section` is named by its heading so landmarks stay navigable.
 * `padding={0}` lets a Table run edge to edge; the header keeps its own padding.
 */
export function SectionCard({
  title,
  description,
  icon,
  end,
  children,
  flush = false,
  ...rest
}: { title: string; description?: React.ReactNode; icon?: IconProps["icon"]; end?: React.ReactNode; children?: React.ReactNode; flush?: boolean } & Omit<React.HTMLAttributes<HTMLElement>, "title">) {
  const id = React.useId()
  return (
    <section aria-labelledby={id} {...rest} className={rest.className}>
      <Card padding={0}>
        <VStack gap={4} padding={flush ? 0 : 4}>
          <HStack gap={3} justify="between" align="start" wrap="wrap" padding={flush ? 4 : 0} paddingBlockEnd={flush ? 0 : undefined}>
            <VStack gap={1} className="min-w-0 flex-1 basis-64">
              <HStack gap={2} align="center">
                {icon && <Icon icon={icon} size="md" color="accent" />}
                <Heading level={2} id={id}>{title}</Heading>
              </HStack>
              {description && <Text type="supporting" as="p">{description}</Text>}
            </VStack>
            {end && <HStack gap={2} align="center" wrap="wrap">{end}</HStack>}
          </HStack>
          {children}
        </VStack>
      </Card>
    </section>
  )
}
