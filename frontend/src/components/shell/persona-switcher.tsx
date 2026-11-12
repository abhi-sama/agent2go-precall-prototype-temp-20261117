"use client"

import { Banner } from "@astryxdesign/core/Banner"
import { Button } from "@astryxdesign/core/Button"
import { Icon } from "@astryxdesign/core/Icon"
import { List, ListItem } from "@astryxdesign/core/List"
import { Popover } from "@astryxdesign/core/Popover"
import { VStack } from "@astryxdesign/core/VStack"
import { UserRound } from "lucide-react"
import { useRouter } from "next/navigation"
import * as React from "react"
import { PERSONA_CONFIG } from "@/components/shell/persona-config"
import { PERSONA_HOME, PERSONA_LABEL } from "@/lib/data/fixtures"
import { PERSONAS } from "@/lib/data/types"
import { IS_LOCAL_BUILD } from "@/lib/env"
import { useSession } from "@/lib/session/session-provider"

/**
 * LOCAL BUILDS ONLY. Lets a developer or reviewer act as any seeded persona without signing in.
 * `IS_LOCAL_BUILD` is inlined at build time, so deployed builds render nothing and ship no switch.
 */
export function PersonaSwitcher() {
  const { user, switchUser, switchableUsers, kind } = useSession()
  const router = useRouter()
  const [open, setOpen] = React.useState(false)

  if (!IS_LOCAL_BUILD) return null

  return (
    <Popover
      label="Switch persona"
      isOpen={open}
      onOpenChange={setOpen}
      placement="below"
      alignment="end"
      width={352}
      padding={3}
      presentation="adaptive"
      content={
        <VStack gap={3}>
          <Banner
            status="warning"
            title="Local build only"
            description={kind === "cognito" ? "Signs in as a seeded Cognito user." : "Synthetic people; no sign-in."}
            collapsible={false}
          />
          <VStack gap={3} isScrollable maxWidth="100%" className="max-h-[60dvh]">
            {PERSONAS.map((persona) => {
              const people = switchableUsers.filter((u) => u.persona === persona)
              if (people.length === 0) return null
              return (
                <List key={persona} header={PERSONA_CONFIG[persona].label} density="spacious">
                  {people.map((u) => {
                    const active = u.userId === user.userId
                    return (
                      <ListItem
                        key={u.userId}
                        data-testid={`persona-option-${u.userId}`}
                        label={u.fullName}
                        description={u.blurb}
                        isSelected={active}
                        endContent={active ? <Icon icon="check" size="sm" /> : undefined}
                        onClick={async () => {
                          setOpen(false)
                          await switchUser(u.userId)
                          router.push(PERSONA_HOME[u.persona])
                        }}
                      />
                    )
                  })}
                </List>
              )
            })}
          </VStack>
        </VStack>
      }
    >
      <Button
        data-testid="persona-switch"
        variant="secondary"
        label={`${PERSONA_LABEL[user.persona]}: ${user.fullName}`}
        icon={<Icon icon={UserRound} />}
      >
        {PERSONA_LABEL[user.persona]}
      </Button>
    </Popover>
  )
}
