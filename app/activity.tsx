import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import type { Activity } from "../src/arc/activity.ts";
import { ActivityRow } from "../src/ui/ActivityRow.tsx";
import { Button } from "../src/ui/Button.tsx";
import { Label } from "../src/ui/Label.tsx";
import { Note } from "../src/ui/Note.tsx";
import { Screen } from "../src/ui/Screen.tsx";
import { Surface } from "../src/ui/Surface.tsx";
import { activityRowText, groupByDay } from "../src/ui/activity-format.ts";
import { useAgentNames } from "../src/ui/agent-names-context.tsx";
import { clockTime, weekdayDayMonth } from "../src/ui/calendar.ts";
import { shortAddress } from "../src/ui/mandate-format.ts";
import { useSession } from "../src/ui/session-context.tsx";
import { useTheme } from "../src/ui/theme-context.tsx";
import { tokens } from "../src/ui/tokens.ts";

/**
 * Everything the agents did, grouped by day. Or one agent's, when opened from its screen.
 *
 * Says how far back it reaches rather than implying it is everything: the first read covers the
 * last day, because reading a month of Arc costs hundreds of requests, and "Show earlier" goes back
 * a day at a time.
 */
export default function ActivityScreen() {
  const { agent } = useLocalSearchParams<{ agent?: string }>();
  const { activity } = useSession();
  const { nameOf } = useAgentNames();
  const router = useRouter();
  const c = useTheme().color;

  const scoped = typeof agent === "string" && agent.length > 0 ? agent.toLowerCase() : null;
  const items = scoped === null ? activity.items : activity.items.filter((i) => i.agent.toLowerCase() === scoped);
  const days = groupByDay(items);
  const title = scoped === null ? "Activity" : nameOf(scoped) ?? shortAddress(scoped);

  const open = useCallback(
    (item: Activity) => router.push({ pathname: "/receipt", params: { tx: item.tx, log: String(item.logIndex) } }),
    [router],
  );

  return (
    <>
      <Stack.Screen options={{ title }} />
      <Screen>
        {activity.error !== null && <Note tone="warn">{activity.error}</Note>}

        {items.length === 0 && !activity.loading && (
          <Surface>
            <Text style={[styles.emptyTitle, { color: c.paper }]}>Nothing yet</Text>
            <Text style={[styles.emptyBody, { color: c.dim }]}>
              When an agent spends from an allowance, each payment appears here within a few seconds.
            </Text>
          </Surface>
        )}

        {days.map((day) => (
          <Section key={day.heading} heading={day.heading}>
            {day.items.map((item, index) => {
              const text = activityRowText(item, { name: nameOf(item.agent), withAgent: scoped === null, underDayHeading: true });
              return (
                <ActivityRow
                  key={`${item.tx}:${item.logIndex}`}
                  item={item}
                  text={text}
                  onPress={open}
                  first={index === 0}
                />
              );
            })}
          </Section>
        ))}

        {activity.loading && <ActivityIndicator color={c.dim} accessibilityLabel="Reading activity from Arc" />}

        {activity.since !== null && (
          <Text style={[styles.since, { color: c.dim }]}>
            Showing activity since {weekdayDayMonth(activity.since)}, {clockTime(activity.since)}.
          </Text>
        )}
        {activity.canLoadEarlier && (
          <Button
            title="Show earlier"
            onPress={activity.loadEarlier}
            busy={activity.loadingEarlier}
            disabled={activity.loading}
          />
        )}
      </Screen>
    </>
  );
}

function Section({ heading, children }: { readonly heading: string; readonly children: ReactNode }) {
  return (
    <>
      <Label>{heading}</Label>
      <Surface style={styles.group}>{children}</Surface>
    </>
  );
}

const styles = StyleSheet.create({
  group: { padding: 0, gap: 0, overflow: "hidden" },
  emptyTitle: tokens.type.headline,
  emptyBody: tokens.type.subheadline,
  since: { ...tokens.type.footnote, textAlign: "center" },
});
