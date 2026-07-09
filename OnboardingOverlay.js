import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./lib/supabase";
import { getTheme, radius as r, spacing as s, typography as t } from "./designSystem";

const ONBOARDING_VERSION = "v1";
const theme = getTheme("dark");

const steps = [
  {
    eyebrow: "Step 1",
    title: "Post your daily bev",
    text: "Tap the green plus, line up the photo, scan or type the drink, rate it, and post.",
  },
  {
    eyebrow: "Step 2",
    title: "Check your feed",
    text: "Crew shows people you add. Explore is where discovery can grow later.",
  },
  {
    eyebrow: "Step 3",
    title: "React fast",
    text: "Tap the thumbs up. Long press it when you want more reactions.",
  },
  {
    eyebrow: "Step 4",
    title: "Build your crew",
    text: "Add people by handle from Profile. Your history lives there too.",
  },
];

function getStorageKey(userId) {
  return `bevcrew:onboarding:${ONBOARDING_VERSION}:${userId}`;
}

export default function OnboardingOverlay() {
  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(true);
  const [userId, setUserId] = useState(null);
  const [stepIndex, setStepIndex] = useState(0);

  const currentStep = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;
  const progressLabel = useMemo(() => `${stepIndex + 1} of ${steps.length}`, [stepIndex]);

  useEffect(() => {
    let mounted = true;

    async function checkSession() {
      const { data } = await supabase.auth.getSession();
      const nextUserId = data.session?.user?.id || null;

      if (!mounted) return;

      if (!nextUserId) {
        setVisible(false);
        setUserId(null);
        setChecking(false);
        return;
      }

      await checkOnboarding(nextUserId);
    }

    checkSession();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user?.id || null;

      if (!nextUserId) {
        setVisible(false);
        setUserId(null);
        setChecking(false);
        return;
      }

      checkOnboarding(nextUserId);
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe?.();
    };
  }, []);

  async function checkOnboarding(nextUserId) {
    setChecking(true);
    setUserId(nextUserId);
    setStepIndex(0);

    const stored = await AsyncStorage.getItem(getStorageKey(nextUserId));
    setVisible(!stored);
    setChecking(false);
  }

  async function finishOnboarding() {
    if (userId) {
      await AsyncStorage.setItem(getStorageKey(userId), "done");
    }

    setVisible(false);
    setStepIndex(0);
  }

  function goNext() {
    if (isLastStep) {
      finishOnboarding();
      return;
    }

    setStepIndex((current) => current + 1);
  }

  if (checking || !visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={finishOnboarding}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.card}>
          <View style={styles.topRow}>
            <Text style={styles.eyebrow}>{currentStep.eyebrow}</Text>
            <Text style={styles.progress}>{progressLabel}</Text>
          </View>

          <Text style={styles.title}>{currentStep.title}</Text>
          <Text style={styles.text}>{currentStep.text}</Text>

          <View style={styles.dotsRow}>
            {steps.map((step, index) => (
              <View
                key={step.title}
                style={[styles.dot, index === stepIndex && styles.dotActive]}
              />
            ))}
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.skipButton} onPress={finishOnboarding}>
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.nextButton} onPress={goNext}>
              <Text style={styles.nextText}>{isLastStep ? "Start" : "Next"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.overlay,
    justifyContent: "center",
    padding: s.xxl,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: r.card,
    padding: s.xxl,
    borderWidth: 1,
    borderColor: theme.border,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: s.xl,
  },
  eyebrow: {
    color: theme.primary,
    fontSize: t.tiny,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  progress: {
    color: theme.muted,
    fontWeight: "900",
    fontSize: t.tiny,
  },
  title: {
    color: theme.text,
    fontSize: t.logo,
    lineHeight: 37,
    fontWeight: "900",
    letterSpacing: -1.1,
    marginBottom: s.md,
  },
  text: {
    color: "#C9D0C6",
    fontSize: t.body,
    lineHeight: 23,
    fontWeight: "700",
  },
  dotsRow: {
    flexDirection: "row",
    gap: s.sm,
    marginTop: s.xxl,
    marginBottom: s.xl,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.surface3,
  },
  dotActive: {
    width: 28,
    backgroundColor: theme.primary,
  },
  actionsRow: {
    flexDirection: "row",
    gap: s.md,
  },
  skipButton: {
    flex: 1,
    minHeight: 48,
    backgroundColor: theme.surface2,
    borderRadius: r.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.border,
  },
  skipText: {
    color: theme.text,
    fontWeight: "900",
    fontSize: t.body,
  },
  nextButton: {
    flex: 1,
    minHeight: 48,
    backgroundColor: theme.primary,
    borderRadius: r.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  nextText: {
    color: "#0B0D0C",
    fontWeight: "900",
    fontSize: t.body,
  },
});
