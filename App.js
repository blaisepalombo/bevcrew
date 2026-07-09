import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  GestureHandlerRootView,
  PinchGestureHandler,
  State,
} from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as FileSystem from "expo-file-system/legacy";
import { decode } from "base64-arraybuffer";
import { supabase } from "./lib/supabase";

const DEFAULT_REACTION = "👍";
const QUICK_REACTIONS = ["🔥", "💯", "😮", "🤢"];
const RATINGS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

const palettes = {
  dark: {
    mode: "dark",
    bg: "#0B0D0C",
    surface: "#151816",
    surface2: "#1F2420",
    text: "#F4F7F2",
    muted: "#9EA79D",
    border: "#2A302C",
    primary: "#8BFF5A",
    primarySoft: "#20331B",
    accent: "#FF4F67",
    accentSoft: "#331A20",
    input: "#171B18",
    tab: "#101311",
  },
  light: {
    mode: "light",
    bg: "#F7F8F3",
    surface: "#FFFFFF",
    surface2: "#EEF2EA",
    text: "#121512",
    muted: "#697166",
    border: "#DCE2D7",
    primary: "#4FD12F",
    primarySoft: "#E7FADA",
    accent: "#E8485C",
    accentSoft: "#FFE5E8",
    input: "#FFFFFF",
    tab: "#FFFFFF",
  },
};

function emptyReactions() {
  return { [DEFAULT_REACTION]: 0, "🔥": 0, "💯": 0, "😮": 0, "🤢": 0 };
}

function formatDate(dateString) {
  const date = new Date(dateString);
  const today = new Date();

  if (date.toDateString() === today.toDateString()) return "Today";

  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatRating(value) {
  return value && value !== "-" ? `${value}/10` : "Not rated";
}

function sanitizeHandle(value) {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24);

  if (cleaned.length >= 3) return cleaned;
  return `user${Math.floor(100 + Math.random() * 900)}`;
}

function deriveNameFromEmail(email) {
  const base = String(email || "bev user").split("@")[0] || "bev user";
  const name = base
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return name || "Bev User";
}

function getVisibleReactionEntries(reactions) {
  return Object.entries(reactions || {})
    .filter(([emoji, count]) => emoji !== DEFAULT_REACTION && Number(count) > 0)
    .sort((first, second) => Number(second[1]) - Number(first[1]));
}

function PinchZoomImage({ uri, styles }) {
  const pinchScale = useRef(new Animated.Value(1)).current;

  const displayScale = pinchScale.interpolate({
    inputRange: [1, 2, 4],
    outputRange: [1, 1.35, 2],
    extrapolate: "clamp",
  });

  const onPinchGestureEvent = Animated.event(
    [{ nativeEvent: { scale: pinchScale } }],
    { useNativeDriver: true }
  );

  function resetPinch(event) {
    const { oldState, state } = event.nativeEvent;

    if (
      oldState === State.ACTIVE ||
      state === State.END ||
      state === State.CANCELLED ||
      state === State.FAILED
    ) {
      Animated.spring(pinchScale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 7,
        tension: 80,
      }).start();
    }
  }

  return (
    <PinchGestureHandler
      minPointers={2}
      onGestureEvent={onPinchGestureEvent}
      onHandlerStateChange={resetPinch}
    >
      <Animated.View style={styles.postImageFrame}>
        <Animated.Image
          source={{ uri }}
          style={[styles.postImage, { transform: [{ scale: displayScale }] }]}
          resizeMode="cover"
        />
      </Animated.View>
    </PinchGestureHandler>
  );
}

export default function App() {
  const [themeMode, setThemeMode] = useState("dark");
  const theme = palettes[themeMode];
  const styles = createStyles(theme);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const photoCameraRef = useRef(null);
  const longPressUsedRef = useRef(false);
  const toastTimerRef = useRef(null);

  const [session, setSession] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authDisplayName, setAuthDisplayName] = useState("");
  const [authHandle, setAuthHandle] = useState("");
  const [authSaving, setAuthSaving] = useState(false);

  const [profile, setProfile] = useState(null);
  const [crewMembers, setCrewMembers] = useState([]);
  const [crewHandleDraft, setCrewHandleDraft] = useState("");
  const [crewSaving, setCrewSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [activeTab, setActiveTab] = useState("Feed");
  const [feedMode, setFeedMode] = useState("crew");
  const [posts, setPosts] = useState([]);
  const [commentDrafts, setCommentDrafts] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const [postStep, setPostStep] = useState(0);
  const [imageUri, setImageUri] = useState(null);
  const [barcode, setBarcode] = useState("");
  const [brand, setBrand] = useState("");
  const [flavor, setFlavor] = useState("");
  const [category, setCategory] = useState("Energy");
  const [rating, setRating] = useState("");
  const [caption, setCaption] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [customCameraOpen, setCustomCameraOpen] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [lookupStatus, setLookupStatus] = useState("");

  const [reactionPickerPostId, setReactionPickerPostId] = useState(null);
  const [customEmojiPostId, setCustomEmojiPostId] = useState(null);
  const [customEmojiInput, setCustomEmojiInput] = useState("");

  const user = session?.user || null;
  const profileDisplayName =
    profile?.display_name || deriveNameFromEmail(user?.email || "bev user");
  const profileHandle =
    profile?.handle || sanitizeHandle(user?.email?.split("@")[0] || profileDisplayName);
  const avatarLetter = (profileDisplayName.trim()[0] || "B").toUpperCase();
  const crewUserIds = new Set([user?.id, ...crewMembers.map((member) => member.id)]);
  const myPosts = posts.filter((post) =>
    post.userId ? post.userId === user?.id : post.user === profileDisplayName
  );
  const visiblePosts = posts.filter((post) => {
    if (feedMode === "explore") return true;
    if (post.userId) return crewUserIds.has(post.userId);
    return post.user === profileDisplayName;
  });
  const categories = ["Energy", "Soda", "Coffee", "Water", "Other"];
  const steps = ["Photo", "Scan", "Post"];

  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      setAuthChecking(true);

      const { data, error } = await supabase.auth.getSession();

      if (!mounted) return;

      if (error) {
        Alert.alert("Auth error", error.message);
        setAuthChecking(false);
        return;
      }

      setSession(data.session);

      if (data.session?.user) {
        await bootstrapUser(data.session.user);
      } else {
        setAuthChecking(false);
      }
    }

    initAuth();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);

      if (nextSession?.user) {
        bootstrapUser(nextSession.user);
      } else {
        setProfile(null);
        setCrewMembers([]);
        setPosts([]);
        setLoading(false);
        setAuthChecking(false);
      }
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe?.();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function toggleTheme() {
    setThemeMode(themeMode === "dark" ? "light" : "dark");
  }

  function showToast(message) {
    setToastMessage(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMessage(""), 2200);
  }

  function isStepReady(step = postStep) {
    if (step === 0) return !!imageUri;
    if (step === 1) return !!brand.trim() && !!flavor.trim();
    return !!imageUri && !!brand.trim() && !!flavor.trim() && !!rating.trim();
  }

  function resetPostFlow() {
    setPostStep(0);
    setImageUri(null);
    setBarcode("");
    setBrand("");
    setFlavor("");
    setCategory("Energy");
    setRating("");
    setCaption("");
    setScannerOpen(false);
    setCustomCameraOpen(false);
    setScanned(false);
    setLookupStatus("");
  }

  async function bootstrapUser(authUser) {
    try {
      setAuthChecking(true);
      setLoading(true);
      await ensureProfile(authUser);
      const members = await loadCrew(authUser.id);
      await loadPosts();
      setLoading(false);
    } catch (error) {
      setLoading(false);
      Alert.alert(
        "Setup needed",
        error.message || "Could not load your account. Make sure the Supabase SQL setup has been run."
      );
    }

    setAuthChecking(false);
  }

  async function fetchProfileById(profileId) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", profileId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function ensureProfile(authUser) {
    const existing = await fetchProfileById(authUser.id);

    if (existing) {
      setProfile(existing);
      return existing;
    }

    const displayName =
      authUser.user_metadata?.display_name ||
      authUser.user_metadata?.name ||
      deriveNameFromEmail(authUser.email);
    const baseHandle = sanitizeHandle(
      authUser.user_metadata?.handle || authUser.email?.split("@")[0] || displayName
    );

    const profileToInsert = {
      id: authUser.id,
      display_name: displayName,
      handle: baseHandle,
    };

    let inserted = await supabase
      .from("profiles")
      .insert(profileToInsert)
      .select("*")
      .single();

    if (inserted.error?.code === "23505") {
      const message = `${inserted.error.message || ""} ${inserted.error.details || ""}`;

      if (message.includes("profiles_pkey")) {
        const retryProfile = await fetchProfileById(authUser.id);
        if (retryProfile) {
          setProfile(retryProfile);
          return retryProfile;
        }
      }

      inserted = await supabase
        .from("profiles")
        .insert({
          ...profileToInsert,
          handle: `${baseHandle}${Math.floor(100 + Math.random() * 900)}`.slice(0, 24),
        })
        .select("*")
        .single();

      if (inserted.error?.code === "23505") {
        const retryProfile = await fetchProfileById(authUser.id);
        if (retryProfile) {
          setProfile(retryProfile);
          return retryProfile;
        }
      }
    }

    if (inserted.error) throw inserted.error;

    setProfile(inserted.data);
    return inserted.data;
  }

  async function loadCrew(currentUserId = user?.id) {
    if (!currentUserId) return [];

    const { data, error } = await supabase
      .from("crew_memberships")
      .select(
        "member_id, profiles!crew_memberships_member_id_fkey(id, display_name, handle, avatar_url)"
      )
      .eq("owner_id", currentUserId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const members = (data || []).map((row) => row.profiles).filter(Boolean);
    setCrewMembers(members);
    return members;
  }

  async function loadPosts() {
    const { data: postRows, error: postError } = await supabase
      .from("posts")
      .select("*")
      .order("created_at", { ascending: false });

    if (postError) throw postError;

    const postIds = (postRows || []).map((post) => post.id);
    let reactionRows = [];
    let commentRows = [];

    if (postIds.length > 0) {
      const { data: reactionsData, error: reactionsError } = await supabase
        .from("reactions")
        .select("post_id, emoji")
        .in("post_id", postIds);

      if (reactionsError) throw reactionsError;

      const { data: commentsData, error: commentsError } = await supabase
        .from("comments")
        .select("id, post_id, user_name, text, created_at")
        .in("post_id", postIds)
        .order("created_at", { ascending: true });

      if (commentsError) throw commentsError;

      reactionRows = reactionsData || [];
      commentRows = commentsData || [];
    }

    const builtPosts = (postRows || []).map((row) => {
      const reactions = emptyReactions();

      reactionRows
        .filter((reaction) => reaction.post_id === row.id)
        .forEach((reaction) => {
          reactions[reaction.emoji] = (reactions[reaction.emoji] || 0) + 1;
        });

      const comments = commentRows
        .filter((comment) => comment.post_id === row.id)
        .map((comment) => ({
          id: comment.id,
          user: comment.user_name,
          text: comment.text,
        }));

      return {
        id: row.id,
        userId: row.user_id,
        user: row.user_name,
        brand: row.brand,
        flavor: row.flavor,
        category: row.category,
        rating: row.rating || "-",
        caption: row.caption || "",
        date: formatDate(row.created_at),
        barcode: row.barcode,
        imageUri: row.image_url,
        reactions,
        comments,
      };
    });

    setPosts(builtPosts);
  }

  async function refreshEverything() {
    if (!user) return;

    setLoading(true);
    try {
      await loadCrew(user.id);
      await loadPosts();
    } catch (error) {
      Alert.alert("Refresh failed", error.message);
    }
    setLoading(false);
  }

  async function handleAuthSubmit() {
    const cleanEmail = authEmail.trim();
    const cleanPassword = authPassword.trim();
    const cleanDisplayName = authDisplayName.trim();
    const cleanHandle = sanitizeHandle(authHandle || cleanDisplayName || cleanEmail.split("@")[0]);
    const isSignup = authMode === "signup";

    if (!cleanEmail || !cleanPassword) {
      Alert.alert("Missing info", "Enter your email and password.");
      return;
    }

    if (cleanPassword.length < 6) {
      Alert.alert("Password too short", "Use at least 6 characters.");
      return;
    }

    if (isSignup && !cleanDisplayName) {
      Alert.alert("Missing name", "Add a display name.");
      return;
    }

    setAuthSaving(true);

    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password: cleanPassword,
          options: {
            data: {
              display_name: cleanDisplayName,
              handle: cleanHandle,
            },
          },
        });

        if (error) throw error;

        if (data.session?.user) {
          setSession(data.session);
          await bootstrapUser(data.session.user);
          showToast("Welcome to bevcrew");
        } else {
          showToast("Check your email to confirm");
          setAuthMode("login");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: cleanPassword,
        });

        if (error) throw error;

        setSession(data.session);
        if (data.session?.user) await bootstrapUser(data.session.user);
      }
    } catch (error) {
      Alert.alert("Auth failed", error.message || "Could not sign in.");
    }

    setAuthSaving(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    resetPostFlow();
    setActiveTab("Feed");
    setProfile(null);
    setCrewMembers([]);
    setPosts([]);
  }

  async function uploadImageToSupabase(uri) {
    const fileExt = uri.split(".").pop()?.split("?")[0] || "jpg";
    const contentType = fileExt.toLowerCase() === "png" ? "image/png" : "image/jpeg";
    const fileName = `bev-${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;

    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });

    const { error } = await supabase.storage
      .from("bev-photos")
      .upload(fileName, decode(base64), { contentType, upsert: false });

    if (error) throw error;

    const { data } = supabase.storage.from("bev-photos").getPublicUrl(fileName);
    return data.publicUrl;
  }

  async function takePhoto() {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();

      if (!permission.granted) {
        Alert.alert("Permission needed", "Camera access is needed to take a bev photo.");
        return;
      }
    }

    setCustomCameraOpen(true);
  }

  async function capturePhoto() {
    try {
      const photo = await photoCameraRef.current?.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      });

      if (photo?.uri) {
        setImageUri(photo.uri);
        setCustomCameraOpen(false);
      }
    } catch (error) {
      Alert.alert("Camera error", "Could not take the photo. Try again.");
    }
  }

  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Permission needed", "Photo access is needed to pick a bev photo.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 5],
      quality: 0.85,
    });

    if (!result.canceled) setImageUri(result.assets[0].uri);
  }

  async function startScanner() {
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();

      if (!permission.granted) {
        Alert.alert("Permission needed", "Camera access is needed to scan a barcode.");
        return;
      }
    }

    setScanned(false);
    setScannerOpen(true);
    setLookupStatus("");
  }

  async function handleBarcodeScanned(result) {
    if (scanned) return;

    const scannedCode = result.data;
    setScanned(true);
    setScannerOpen(false);
    setBarcode(scannedCode);
    setLookupStatus("Looking it up...");
    await lookupBarcode(scannedCode);
  }

  async function lookupBarcode(code) {
    try {
      const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json`);
      const data = await response.json();

      if (data.status === 1 && data.product) {
        const product = data.product;
        const foundBrand = product.brands ? product.brands.split(",")[0].trim() : "";
        const foundName = product.product_name || product.generic_name || "";

        if (foundBrand) setBrand(foundBrand);
        if (foundName) setFlavor(foundName);
        setLookupStatus("Found it. Check the details.");
      } else {
        setLookupStatus("No match. Type it manually.");
      }
    } catch (error) {
      setLookupStatus("Lookup failed. Type it manually.");
    }
  }

  function goNext() {
    if (!isStepReady()) return;
    if (postStep < steps.length - 1) setPostStep(postStep + 1);
  }

  async function postBev() {
    if (!isStepReady(2) || !user) {
      Alert.alert("Missing info", "Add the photo, drink details, and rating first.");
      return;
    }

    setSaving(true);

    try {
      const uploadedImageUrl = await uploadImageToSupabase(imageUri);

      const { error } = await supabase.from("posts").insert({
        user_id: user.id,
        user_name: profileDisplayName,
        brand: brand.trim(),
        flavor: flavor.trim(),
        category,
        rating: rating.trim(),
        caption: caption.trim(),
        barcode: barcode || null,
        image_url: uploadedImageUrl,
      });

      if (error) throw error;

      resetPostFlow();
      setFeedMode("crew");
      setActiveTab("Feed");
      await loadPosts();
      showToast("Posted to crew");
    } catch (error) {
      Alert.alert("Save failed", error.message || "Could not save your bev.");
    }

    setSaving(false);
  }

  function reactToPost(postId, emoji) {
    const cleanEmoji = emoji.trim();
    if (!cleanEmoji || !user) return;

    longPressUsedRef.current = false;
    setReactionPickerPostId(null);
    setCustomEmojiPostId(null);
    setCustomEmojiInput("");

    setPosts((currentPosts) =>
      currentPosts.map((post) =>
        post.id === postId
          ? {
              ...post,
              reactions: {
                ...post.reactions,
                [cleanEmoji]: (post.reactions?.[cleanEmoji] || 0) + 1,
              },
            }
          : post
      )
    );

    supabase
      .from("reactions")
      .insert({
        post_id: postId,
        emoji: cleanEmoji,
        user_id: user.id,
        user_name: profileDisplayName,
      })
      .then(({ error }) => {
        if (error) {
          Alert.alert("Reaction failed", error.message);
          loadPosts();
        }
      });
  }

  function handleDefaultReactionPress(postId) {
    if (longPressUsedRef.current) {
      longPressUsedRef.current = false;
      return;
    }

    reactToPost(postId, DEFAULT_REACTION);
  }

  function openReactionPicker(postId) {
    longPressUsedRef.current = true;
    setReactionPickerPostId(postId);
  }

  function closeReactionPicker() {
    longPressUsedRef.current = false;
    setReactionPickerPostId(null);
  }

  function openCustomEmojiPicker(postId) {
    longPressUsedRef.current = false;
    setReactionPickerPostId(null);
    setCustomEmojiInput("");
    setCustomEmojiPostId(postId);
  }

  function closeCustomEmojiPicker() {
    longPressUsedRef.current = false;
    setCustomEmojiPostId(null);
    setCustomEmojiInput("");
  }

  function addCustomReaction() {
    const cleanEmoji = customEmojiInput.trim();
    if (!cleanEmoji || !customEmojiPostId) return;
    reactToPost(customEmojiPostId, cleanEmoji);
  }

  async function addComment(postId) {
    const text = (commentDrafts[postId] || "").trim();
    if (!text || !user) return;

    const tempComment = { id: `temp-${Date.now()}`, user: profileDisplayName, text };

    setPosts((currentPosts) =>
      currentPosts.map((post) =>
        post.id === postId
          ? { ...post, comments: [...(post.comments || []), tempComment] }
          : post
      )
    );

    setCommentDrafts((drafts) => ({ ...drafts, [postId]: "" }));

    const { error } = await supabase.from("comments").insert({
      post_id: postId,
      user_id: user.id,
      user_name: profileDisplayName,
      text,
    });

    if (error) {
      Alert.alert("Comment failed", error.message);
      await loadPosts();
    }
  }

  async function addCrewMember() {
    const handle = sanitizeHandle(crewHandleDraft);
    if (!handle || !user) return;

    setCrewSaving(true);

    const { data: foundProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, display_name, handle, avatar_url")
      .eq("handle", handle)
      .maybeSingle();

    if (profileError) {
      setCrewSaving(false);
      Alert.alert("Crew error", profileError.message);
      return;
    }

    if (!foundProfile) {
      setCrewSaving(false);
      showToast("No user found");
      return;
    }

    if (foundProfile.id === user.id) {
      setCrewSaving(false);
      showToast("That is you");
      return;
    }

    const { error } = await supabase.from("crew_memberships").insert({
      owner_id: user.id,
      member_id: foundProfile.id,
    });

    if (error && error.code !== "23505") {
      setCrewSaving(false);
      Alert.alert("Crew error", error.message);
      return;
    }

    setCrewHandleDraft("");
    await loadCrew(user.id);
    await loadPosts();
    showToast(error?.code === "23505" ? "Already in crew" : "Added to crew");
    setCrewSaving(false);
  }

  async function removeCrewMember(memberId) {
    if (!user) return;

    const { error } = await supabase
      .from("crew_memberships")
      .delete()
      .eq("owner_id", user.id)
      .eq("member_id", memberId);

    if (error) {
      Alert.alert("Crew error", error.message);
      return;
    }

    await loadCrew(user.id);
    await loadPosts();
    showToast("Removed from crew");
  }

  function renderToast() {
    return toastMessage ? (
      <View style={styles.toast} pointerEvents="none">
        <Text style={styles.toastText}>{toastMessage}</Text>
      </View>
    ) : null;
  }

  function renderAuthScreen() {
    const isSignup = authMode === "signup";

    return (
      <KeyboardAvoidingView
        style={styles.authScreen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.authScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.authLogo}>bevcrew</Text>
          <Text style={styles.authSubtitle}>daily bevs with friends</Text>

          <View style={styles.authCard}>
            <Text style={styles.authTitle}>{isSignup ? "Create account" : "Log in"}</Text>

            <View style={styles.authModeRow}>
              <TouchableOpacity
                style={[styles.authModeButton, !isSignup && styles.authModeButtonActive]}
                onPress={() => setAuthMode("login")}
              >
                <Text style={[styles.authModeText, !isSignup && styles.authModeTextActive]}>
                  Login
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.authModeButton, isSignup && styles.authModeButtonActive]}
                onPress={() => setAuthMode("signup")}
              >
                <Text style={[styles.authModeText, isSignup && styles.authModeTextActive]}>
                  Signup
                </Text>
              </TouchableOpacity>
            </View>

            {isSignup ? (
              <>
                <Text style={styles.inputLabel}>Display name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Blaise"
                  placeholderTextColor={theme.muted}
                  value={authDisplayName}
                  onChangeText={setAuthDisplayName}
                />

                <Text style={styles.inputLabel}>Handle</Text>
                <TextInput
                  style={styles.input}
                  placeholder="blaise"
                  placeholderTextColor={theme.muted}
                  autoCapitalize="none"
                  value={authHandle}
                  onChangeText={setAuthHandle}
                />
              </>
            ) : null}

            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="you@email.com"
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={authEmail}
              onChangeText={setAuthEmail}
            />

            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="at least 6 characters"
              placeholderTextColor={theme.muted}
              secureTextEntry
              value={authPassword}
              onChangeText={setAuthPassword}
            />

            <TouchableOpacity
              style={[styles.primaryButton, authSaving && styles.primaryButtonDisabled]}
              onPress={handleAuthSubmit}
              disabled={authSaving}
            >
              <Text
                style={[
                  styles.primaryButtonText,
                  authSaving && styles.primaryButtonTextDisabled,
                ]}
              >
                {authSaving ? "Working..." : isSignup ? "Create account" : "Log in"}
              </Text>
            </TouchableOpacity>

            <Text style={styles.authFooterText}>
              {isSignup ? "Already have an account? Tap Login." : "New here? Tap Signup."}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  function renderStepHeader() {
    return (
      <View style={styles.stepWrap}>
        {steps.map((step, index) => (
          <View key={step} style={styles.stepItem}>
            <View style={[styles.stepDot, index <= postStep && styles.stepDotActive]}>
              <Text style={[styles.stepNumber, index <= postStep && styles.stepNumberActive]}>
                {index + 1}
              </Text>
            </View>
            <Text style={[styles.stepLabel, index === postStep && styles.stepLabelActive]}>
              {step}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  function renderPostButtons() {
    const primaryDisabled = saving || !isStepReady();

    return (
      <View style={styles.wizardButtons}>
        {postStep > 0 ? (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setPostStep(postStep - 1)}
            disabled={saving}
          >
            <Text style={styles.secondaryButtonText}>Back</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.secondaryButton} onPress={resetPostFlow} disabled={saving}>
            <Text style={styles.secondaryButtonText}>Clear</Text>
          </TouchableOpacity>
        )}

        {postStep < steps.length - 1 ? (
          <TouchableOpacity
            style={[styles.primaryButton, primaryDisabled && styles.primaryButtonDisabled]}
            onPress={goNext}
            disabled={primaryDisabled}
          >
            <Text
              style={[
                styles.primaryButtonText,
                primaryDisabled && styles.primaryButtonTextDisabled,
              ]}
            >
              Next
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.primaryButton, primaryDisabled && styles.primaryButtonDisabled]}
            onPress={postBev}
            disabled={primaryDisabled}
          >
            <Text
              style={[
                styles.primaryButtonText,
                primaryDisabled && styles.primaryButtonTextDisabled,
              ]}
            >
              {saving ? "Posting..." : "Post Bev"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  function renderFeedModeTabs() {
    return (
      <View style={styles.feedModeTabs}>
        <TouchableOpacity
          style={[styles.feedModeButton, feedMode === "crew" && styles.feedModeButtonActive]}
          onPress={() => setFeedMode("crew")}
        >
          <Text style={[styles.feedModeText, feedMode === "crew" && styles.feedModeTextActive]}>
            Crew
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.feedModeButton, feedMode === "explore" && styles.feedModeButtonActive]}
          onPress={() => setFeedMode("explore")}
        >
          <Text
            style={[styles.feedModeText, feedMode === "explore" && styles.feedModeTextActive]}
          >
            Explore
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderFeed() {
    if (loading) {
      return (
        <View style={styles.loadingScreen}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingText}>Loading bevcrew...</Text>
        </View>
      );
    }

    return (
      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {renderFeedModeTabs()}

        <View style={styles.heroCard}>
          <View style={styles.heroTextWrap}>
            <Text style={styles.heroTitle}>{feedMode === "crew" ? "Crew Feed" : "Explore"}</Text>
            <Text style={styles.heroText}>
              {feedMode === "crew"
                ? "Posts from you and your crew."
                : "Find new bevs and people to follow later."}
            </Text>
          </View>

          <TouchableOpacity style={styles.heroButton} onPress={() => setActiveTab("Post")}>
            <Text style={styles.heroButtonText}>Post</Text>
          </TouchableOpacity>
        </View>

        {visiblePosts.length === 0 ? (
          <View style={styles.feedCard}>
            <Text style={styles.bevName}>No posts here yet</Text>
            <Text style={styles.flavorName}>
              {feedMode === "crew" ? "Post a drink or add someone by handle." : "Explore will fill up as more people join."}
            </Text>
          </View>
        ) : null}

        {visiblePosts.map((post) => {
          const visibleReactions = getVisibleReactionEntries(post.reactions);

          return (
            <View key={post.id} style={styles.feedCard}>
              <View style={styles.cardTop}>
                <View>
                  <Text style={styles.username}>{post.user}</Text>
                  <Text style={styles.date}>{post.date}</Text>
                </View>

                <View style={styles.categoryPill}>
                  <Text style={styles.categoryPillText}>{post.category}</Text>
                </View>
              </View>

              {post.imageUri ? (
                <PinchZoomImage uri={post.imageUri} styles={styles} />
              ) : (
                <View style={styles.placeholderPortrait}>
                  <Text style={styles.photoText}>4:5 bev photo</Text>
                </View>
              )}

              <Text style={styles.bevName}>{post.brand}</Text>
              <Text style={styles.flavorName}>{post.flavor}</Text>

              <View style={styles.metaRow}>
                <Text style={styles.rating}>Rating: {formatRating(post.rating)}</Text>
              </View>

              {post.caption ? <Text style={styles.caption}>{post.caption}</Text> : null}

              <ScrollView
                horizontal
                style={styles.reactionScroll}
                contentContainerStyle={styles.reactionScrollContent}
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <TouchableOpacity
                  style={styles.defaultReactionButton}
                  onPress={() => handleDefaultReactionPress(post.id)}
                  onLongPress={() => openReactionPicker(post.id)}
                  delayLongPress={300}
                >
                  <Text style={styles.defaultReactionText}>
                    {DEFAULT_REACTION} {post.reactions?.[DEFAULT_REACTION] || 0}
                  </Text>
                </TouchableOpacity>

                {visibleReactions.map(([emoji, count]) => (
                  <TouchableOpacity
                    key={emoji}
                    style={styles.reactionChip}
                    onPress={() => reactToPost(post.id, emoji)}
                  >
                    <Text style={styles.reactionChipText}>
                      {emoji} {count}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {post.comments.length > 0 ? (
                <View style={styles.commentsBox}>
                  {post.comments.map((comment) => (
                    <Text key={comment.id} style={styles.commentText}>
                      <Text style={styles.commentUser}>{comment.user}: </Text>
                      {comment.text}
                    </Text>
                  ))}
                </View>
              ) : null}

              <View style={styles.commentRow}>
                <TextInput
                  style={styles.commentInput}
                  placeholder="comment"
                  placeholderTextColor={theme.muted}
                  value={commentDrafts[post.id] || ""}
                  onChangeText={(text) =>
                    setCommentDrafts({ ...commentDrafts, [post.id]: text })
                  }
                />

                <TouchableOpacity style={styles.commentButton} onPress={() => addComment(post.id)}>
                  <Text style={styles.commentButtonText}>➤</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>
    );
  }

  function renderPostFlow() {
    if (customCameraOpen) {
      return (
        <View style={styles.cameraCaptureScreen}>
          <View style={styles.cameraCaptureHeader}>
            <Text style={styles.cameraCaptureTitle}>Line up your bev</Text>
            <Text style={styles.cameraCaptureText}>Same 4:5 shape as the feed.</Text>
          </View>

          <View style={styles.cameraFrame}>
            <CameraView ref={photoCameraRef} style={styles.cameraPreview} facing="back" />
          </View>

          <View style={styles.cameraControls}>
            <TouchableOpacity
              style={styles.cameraCancelButton}
              onPress={() => setCustomCameraOpen(false)}
            >
              <Text style={styles.cameraCancelText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.captureButtonOuter} onPress={capturePhoto}>
              <View style={styles.captureButtonInner} />
            </TouchableOpacity>

            <View style={styles.cameraControlSpacer} />
          </View>
        </View>
      );
    }

    if (scannerOpen) {
      return (
        <View style={styles.scannerScreen}>
          <CameraView
            style={styles.camera}
            facing="back"
            onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
            barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
          />

          <View style={styles.scannerOverlay}>
            <Text style={styles.scannerTitle}>Scan barcode</Text>
            <Text style={styles.scannerText}>Center the barcode in the box.</Text>
            <View style={styles.scanBox} />
            <TouchableOpacity style={styles.scannerClose} onPress={() => setScannerOpen(false)}>
              <Text style={styles.scannerCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.screenTitle}>Today’s Bev</Text>
          <Text style={styles.screenSubtitle}>Snap, scan, rate, post.</Text>

          {renderStepHeader()}

          {postStep === 0 && (
            <View style={styles.wizardCard}>
              <Text style={styles.cardTitle}>Add photo</Text>
              <Text style={styles.cardHint}>Frame it in 4:5 and snap.</Text>

              <View style={styles.photoCompactCard}>
                {imageUri ? (
                  <Image source={{ uri: imageUri }} style={styles.photoThumbnail} />
                ) : (
                  <View style={styles.photoThumbnailEmpty}>
                    <Text style={styles.photoThumbnailIcon}>＋</Text>
                  </View>
                )}

                <View style={styles.photoActionArea}>
                  <Text style={styles.photoStatus}>{imageUri ? "Photo ready" : "No photo yet"}</Text>
                  <Text style={styles.photoSubtext}>
                    {imageUri ? "Retake or keep going." : "Use the feed shape."}
                  </Text>

                  <View style={styles.photoButtonRow}>
                    <TouchableOpacity style={styles.compactPrimary} onPress={takePhoto}>
                      <Text style={styles.compactPrimaryText}>
                        {imageUri ? "Retake" : "Take photo"}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.compactSecondary} onPress={pickImage}>
                      <Text style={styles.compactSecondaryText}>Library</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          )}

          {postStep === 1 && (
            <View style={styles.wizardCard}>
              <Text style={styles.cardTitle}>Drink details</Text>
              <Text style={styles.cardHint}>Scan it, or type it manually.</Text>

              <TouchableOpacity style={styles.scanButton} onPress={startScanner}>
                <Text style={styles.scanButtonText}>Scan barcode</Text>
              </TouchableOpacity>

              <Text style={styles.manualHint}>No barcode match? Just fill it in below.</Text>
              {barcode ? <Text style={styles.lookupText}>Barcode: {barcode}</Text> : null}
              {lookupStatus ? <Text style={styles.lookupText}>{lookupStatus}</Text> : null}

              <Text style={styles.inputLabel}>Brand</Text>
              <TextInput
                style={styles.input}
                placeholder="Ghost, Monster, Celsius..."
                placeholderTextColor={theme.muted}
                value={brand}
                onChangeText={setBrand}
              />

              <Text style={styles.inputLabel}>Drink / Flavor</Text>
              <TextInput
                style={styles.input}
                placeholder="Sour Patch Blue Raspberry"
                placeholderTextColor={theme.muted}
                value={flavor}
                onChangeText={setFlavor}
              />

              <Text style={styles.inputLabel}>Category</Text>
              <View style={styles.chipRow}>
                {categories.map((item) => (
                  <TouchableOpacity
                    key={item}
                    style={[styles.chip, category === item && styles.chipActive]}
                    onPress={() => setCategory(item)}
                  >
                    <Text style={[styles.chipText, category === item && styles.chipTextActive]}>
                      {item}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {postStep === 2 && (
            <View style={styles.wizardCard}>
              <Text style={styles.cardTitle}>Rate and post</Text>
              <Text style={styles.cardHint}>Pick a rating. Caption is optional.</Text>

              <View style={styles.reviewSummaryCard}>
                {imageUri ? <Image source={{ uri: imageUri }} style={styles.reviewThumbnail} /> : null}

                <View style={styles.reviewTextWrap}>
                  <Text style={styles.reviewBrand}>{brand || "Brand"}</Text>
                  <Text style={styles.reviewFlavor}>{flavor || "Flavor"}</Text>
                  <Text style={styles.reviewCategory}>{category}</Text>
                </View>
              </View>

              <View style={styles.ratingHeaderRow}>
                <Text style={styles.inputLabel}>Rating</Text>
                <Text style={styles.ratingSelected}>{rating ? `${rating}/10` : "pick one"}</Text>
              </View>

              <View style={styles.ratingGrid}>
                {RATINGS.map((num) => (
                  <TouchableOpacity
                    key={num}
                    style={[styles.ratingBubble, rating === num && styles.ratingBubbleActive]}
                    onPress={() => setRating(num)}
                  >
                    <Text
                      style={[
                        styles.ratingBubbleText,
                        rating === num && styles.ratingBubbleTextActive,
                      ]}
                    >
                      {num}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.ratingGuideRow}>
                <Text style={styles.ratingGuideText}>1 rough</Text>
                <Text style={styles.ratingGuideText}>10 elite</Text>
              </View>

              <Text style={styles.inputLabel}>Caption</Text>
              <TextInput
                style={[styles.input, styles.captionInput]}
                placeholder="rare find, elite, mid..."
                placeholderTextColor={theme.muted}
                value={caption}
                onChangeText={setCaption}
                multiline
              />
            </View>
          )}

          {renderPostButtons()}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  function renderHistoryPreview() {
    return (
      <View style={styles.crewCard}>
        <View style={styles.crewTitleRow}>
          <Text style={styles.cardTitle}>History</Text>
          <TouchableOpacity style={styles.smallPillButton} onPress={() => setHistoryOpen(!historyOpen)}>
            <Text style={styles.smallPillText}>{historyOpen ? "Hide" : "Show"}</Text>
          </TouchableOpacity>
        </View>

        {!historyOpen ? (
          <Text style={styles.crewEmpty}>Your past drinks live here now.</Text>
        ) : myPosts.length === 0 ? (
          <Text style={styles.crewEmpty}>No posts yet.</Text>
        ) : (
          myPosts.map((post) => (
            <View key={post.id} style={styles.historyItem}>
              {post.imageUri ? (
                <Image source={{ uri: post.imageUri }} style={styles.historyImage} />
              ) : (
                <View style={styles.historyPlaceholder}>
                  <Text style={styles.photoText}>no photo</Text>
                </View>
              )}

              <View style={styles.historyText}>
                <Text style={styles.historyDate}>{post.date}</Text>
                <Text style={styles.historyBev}>{post.brand}</Text>
                <Text style={styles.historyFlavor}>{post.flavor}</Text>
                <Text style={styles.historyRating}>{formatRating(post.rating)}</Text>
              </View>
            </View>
          ))
        )}
      </View>
    );
  }

  function renderProfile() {
    return (
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.screenTitle}>Profile</Text>
        <Text style={styles.screenSubtitle}>Your bev stats and crew.</Text>

        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{avatarLetter}</Text>
          </View>

          <Text style={styles.profileName}>{profileDisplayName}</Text>
          <Text style={styles.profileHandle}>@{profileHandle}</Text>
          <Text style={styles.profileEmail}>{user?.email}</Text>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{myPosts.length}</Text>
              <Text style={styles.statLabel}>bevs</Text>
            </View>

            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{myPosts.length}</Text>
              <Text style={styles.statLabel}>streak</Text>
            </View>

            <View style={styles.statBoxAccent}>
              <Text style={styles.statNumber}>{crewMembers.length}</Text>
              <Text style={styles.statLabel}>crew</Text>
            </View>
          </View>
        </View>

        {renderHistoryPreview()}

        <View style={styles.crewCard}>
          <View style={styles.crewTitleRow}>
            <Text style={styles.cardTitle}>Crew</Text>
            <Text style={styles.ratingSelected}>{crewMembers.length}</Text>
          </View>

          <View style={styles.crewAddRow}>
            <TextInput
              style={styles.crewInput}
              placeholder="add by handle"
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              value={crewHandleDraft}
              onChangeText={setCrewHandleDraft}
            />
            <TouchableOpacity
              style={[styles.crewButton, crewSaving && styles.primaryButtonDisabled]}
              onPress={addCrewMember}
              disabled={crewSaving}
            >
              <Text style={styles.crewButtonText}>Add</Text>
            </TouchableOpacity>
          </View>

          {crewMembers.length === 0 ? (
            <Text style={styles.crewEmpty}>Add someone’s handle to see their posts.</Text>
          ) : null}

          {crewMembers.map((member) => (
            <View key={member.id} style={styles.crewListItem}>
              <View>
                <Text style={styles.crewName}>{member.display_name}</Text>
                <Text style={styles.crewHandle}>@{member.handle}</Text>
              </View>

              <TouchableOpacity style={styles.removeButton} onPress={() => removeCrewMember(member.id)}>
                <Text style={styles.removeButtonText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  function renderReactionPicker() {
    return (
      <Modal
        visible={!!reactionPickerPostId}
        transparent
        animationType="fade"
        onRequestClose={closeReactionPicker}
      >
        <View style={styles.pickerBackdrop}>
          <TouchableOpacity
            style={styles.pickerBackdropPressTarget}
            activeOpacity={1}
            onPress={closeReactionPicker}
          />

          <View style={styles.reactionPicker}>
            {QUICK_REACTIONS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                style={styles.pickerReactionButton}
                onPress={() => reactToPost(reactionPickerPostId, emoji)}
              >
                <Text style={styles.pickerReactionText}>{emoji}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.pickerReactionButton}
              onPress={() => openCustomEmojiPicker(reactionPickerPostId)}
            >
              <Text style={styles.pickerPlusText}>＋</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  function renderCustomEmojiPicker() {
    return (
      <Modal
        visible={!!customEmojiPostId}
        transparent
        animationType="fade"
        onRequestClose={closeCustomEmojiPicker}
      >
        <View style={styles.pickerBackdrop}>
          <TouchableOpacity
            style={styles.pickerBackdropPressTarget}
            activeOpacity={1}
            onPress={closeCustomEmojiPicker}
          />

          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.customEmojiCard}
          >
            <Text style={styles.customEmojiTitle}>Choose emoji</Text>
            <TextInput
              style={styles.customEmojiInput}
              value={customEmojiInput}
              onChangeText={setCustomEmojiInput}
              placeholder="emoji"
              placeholderTextColor={theme.muted}
              autoFocus
              maxLength={8}
            />

            <View style={styles.customEmojiActions}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={closeCustomEmojiPicker}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.modalConfirmButton} onPress={addCustomReaction}>
                <Text style={styles.modalConfirmText}>React</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    );
  }

  function renderBottomNav() {
    return (
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={styles.navSideButton}
          onPress={() => setActiveTab("Feed")}
        >
          <Text style={[styles.navText, activeTab === "Feed" && styles.navTextActive]}>Feed</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.postNavButton, activeTab === "Post" && styles.postNavButtonActive]}
          onPress={() => setActiveTab("Post")}
        >
          <Text style={styles.postNavPlus}>＋</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navSideButton}
          onPress={() => setActiveTab("Profile")}
        >
          <Text style={[styles.navText, activeTab === "Profile" && styles.navTextActive]}>
            Profile
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (authChecking) {
    return (
      <GestureHandlerRootView style={styles.gestureRoot}>
        <SafeAreaView style={styles.container}>
          <StatusBar style={theme.mode === "dark" ? "light" : "dark"} />
          <View style={styles.loadingScreen}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={styles.loadingText}>Checking account...</Text>
          </View>
        </SafeAreaView>
      </GestureHandlerRootView>
    );
  }

  if (!session) {
    return (
      <GestureHandlerRootView style={styles.gestureRoot}>
        <SafeAreaView style={styles.container}>
          <StatusBar style={theme.mode === "dark" ? "light" : "dark"} />
          {renderAuthScreen()}
          {renderToast()}
        </SafeAreaView>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaView style={styles.container}>
        <StatusBar style={theme.mode === "dark" ? "light" : "dark"} />

        {!scannerOpen && !customCameraOpen ? (
          <View style={styles.header}>
            <View>
              <Text style={styles.logo}>bevcrew</Text>
              <Text style={styles.subtitle}>@{profileHandle}</Text>
            </View>

            <TouchableOpacity style={styles.themeButton} onPress={toggleTheme}>
              <Text style={styles.themeButtonText}>{themeMode === "dark" ? "Light" : "Dark"}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {activeTab === "Feed" && renderFeed()}
        {activeTab === "Post" && renderPostFlow()}
        {activeTab === "Profile" && renderProfile()}

        {!scannerOpen && !customCameraOpen ? renderBottomNav() : null}

        {renderToast()}
        {renderReactionPicker()}
        {renderCustomEmojiPicker()}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    gestureRoot: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    container: {
      flex: 1,
      backgroundColor: theme.bg,
    },
    loadingScreen: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },
    loadingText: {
      color: theme.muted,
      fontWeight: "800",
    },
    authScreen: {
      flex: 1,
      padding: 16,
    },
    authScroll: {
      flexGrow: 1,
      justifyContent: "center",
      paddingVertical: 28,
    },
    authLogo: {
      color: theme.text,
      fontSize: 42,
      fontWeight: "900",
      letterSpacing: -1.8,
      textAlign: "center",
    },
    authSubtitle: {
      color: theme.muted,
      textAlign: "center",
      marginTop: 4,
      marginBottom: 22,
      fontWeight: "700",
    },
    authCard: {
      backgroundColor: theme.surface,
      borderRadius: 30,
      padding: 18,
      borderWidth: 1,
      borderColor: theme.border,
    },
    authTitle: {
      color: theme.text,
      fontSize: 26,
      fontWeight: "900",
      marginBottom: 12,
    },
    authModeRow: {
      flexDirection: "row",
      backgroundColor: theme.surface2,
      padding: 4,
      borderRadius: 999,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: theme.border,
    },
    authModeButton: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 999,
      alignItems: "center",
    },
    authModeButtonActive: {
      backgroundColor: theme.primary,
    },
    authModeText: {
      color: theme.muted,
      fontWeight: "900",
    },
    authModeTextActive: {
      color: "#0B0D0C",
    },
    authFooterText: {
      color: theme.muted,
      textAlign: "center",
      marginTop: 14,
      fontWeight: "700",
    },
    header: {
      paddingHorizontal: 18,
      paddingTop: 14,
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      backgroundColor: theme.bg,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    logo: {
      color: theme.text,
      fontSize: 32,
      fontWeight: "900",
      letterSpacing: -1.5,
    },
    subtitle: {
      color: theme.muted,
      fontSize: 13,
      marginTop: 2,
    },
    themeButton: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 999,
    },
    themeButtonText: {
      color: theme.text,
      fontWeight: "800",
      fontSize: 12,
    },
    content: {
      flex: 1,
      padding: 16,
    },
    screenTitle: {
      color: theme.text,
      fontSize: 28,
      fontWeight: "900",
      letterSpacing: -0.8,
      marginBottom: 4,
    },
    screenSubtitle: {
      color: theme.muted,
      fontSize: 14,
      marginBottom: 18,
    },
    feedModeTabs: {
      flexDirection: "row",
      backgroundColor: theme.surface,
      padding: 5,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: 14,
    },
    feedModeButton: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: 999,
      alignItems: "center",
    },
    feedModeButtonActive: {
      backgroundColor: theme.primary,
    },
    feedModeText: {
      color: theme.muted,
      fontWeight: "900",
    },
    feedModeTextActive: {
      color: "#0B0D0C",
    },
    heroCard: {
      backgroundColor: theme.primarySoft,
      borderRadius: 26,
      padding: 18,
      marginBottom: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: theme.border,
      gap: 12,
    },
    heroTextWrap: {
      flex: 1,
      paddingRight: 8,
    },
    heroTitle: {
      color: theme.text,
      fontSize: 22,
      fontWeight: "900",
    },
    heroText: {
      color: theme.muted,
      marginTop: 4,
      lineHeight: 20,
    },
    heroButton: {
      backgroundColor: theme.primary,
      paddingHorizontal: 18,
      paddingVertical: 11,
      borderRadius: 999,
      flexShrink: 0,
    },
    heroButtonText: {
      color: "#0B0D0C",
      fontWeight: "900",
    },
    feedCard: {
      backgroundColor: theme.surface,
      borderRadius: 28,
      padding: 14,
      marginBottom: 18,
      borderWidth: 1,
      borderColor: theme.border,
    },
    cardTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    username: {
      color: theme.text,
      fontSize: 16,
      fontWeight: "900",
    },
    date: {
      color: theme.muted,
      marginTop: 2,
    },
    categoryPill: {
      backgroundColor: theme.accentSoft,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    categoryPillText: {
      color: theme.accent,
      fontWeight: "900",
      fontSize: 12,
    },
    postImageFrame: {
      width: "100%",
      aspectRatio: 4 / 5,
      borderRadius: 24,
      marginBottom: 14,
      overflow: "hidden",
      backgroundColor: theme.surface2,
    },
    postImage: {
      width: "100%",
      height: "100%",
      backgroundColor: theme.surface2,
    },
    placeholderPortrait: {
      width: "100%",
      aspectRatio: 4 / 5,
      backgroundColor: theme.surface2,
      borderRadius: 24,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: 14,
      borderWidth: 1,
      borderColor: theme.border,
    },
    photoText: {
      color: theme.muted,
      fontWeight: "800",
    },
    bevName: {
      color: theme.text,
      fontSize: 23,
      fontWeight: "900",
      letterSpacing: -0.4,
    },
    flavorName: {
      color: theme.muted,
      fontSize: 16,
      fontWeight: "700",
      marginTop: 2,
      marginBottom: 12,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 10,
    },
    rating: {
      color: theme.primary,
      fontWeight: "900",
    },
    caption: {
      color: theme.text,
      lineHeight: 20,
      backgroundColor: theme.surface2,
      padding: 12,
      borderRadius: 16,
      overflow: "hidden",
      marginBottom: 12,
    },
    reactionScroll: {
      marginBottom: 12,
      marginHorizontal: -2,
    },
    reactionScrollContent: {
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 2,
      paddingRight: 12,
    },
    defaultReactionButton: {
      alignSelf: "flex-start",
      backgroundColor: theme.surface2,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
    },
    defaultReactionText: {
      color: theme.text,
      fontWeight: "900",
      fontSize: 15,
    },
    reactionChip: {
      backgroundColor: theme.surface2,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
    },
    reactionChipText: {
      color: theme.text,
      fontWeight: "900",
      fontSize: 14,
    },
    commentsBox: {
      backgroundColor: theme.surface2,
      borderRadius: 16,
      padding: 12,
      marginBottom: 10,
    },
    commentText: {
      color: theme.text,
      lineHeight: 20,
      marginBottom: 4,
    },
    commentUser: {
      fontWeight: "900",
      color: theme.primary,
    },
    commentRow: {
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
    },
    commentInput: {
      flex: 1,
      backgroundColor: theme.input,
      color: theme.text,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderWidth: 1,
      borderColor: theme.border,
    },
    commentButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    commentButtonText: {
      color: "#0B0D0C",
      fontWeight: "900",
      fontSize: 18,
      marginLeft: 2,
    },
    pickerBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.34)",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
    },
    pickerBackdropPressTarget: {
      ...StyleSheet.absoluteFillObject,
    },
    reactionPicker: {
      backgroundColor: theme.surface,
      borderRadius: 999,
      padding: 10,
      flexDirection: "row",
      gap: 8,
      borderWidth: 1,
      borderColor: theme.border,
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 18,
      elevation: 8,
    },
    pickerReactionButton: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: theme.surface2,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.border,
    },
    pickerReactionText: {
      fontSize: 23,
    },
    pickerPlusText: {
      color: theme.text,
      fontSize: 25,
      fontWeight: "700",
    },
    customEmojiCard: {
      width: "100%",
      maxWidth: 340,
      backgroundColor: theme.surface,
      borderRadius: 26,
      padding: 18,
      borderWidth: 1,
      borderColor: theme.border,
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 18,
      elevation: 8,
    },
    customEmojiTitle: {
      color: theme.text,
      fontSize: 20,
      fontWeight: "900",
      marginBottom: 12,
    },
    customEmojiInput: {
      backgroundColor: theme.input,
      color: theme.text,
      borderRadius: 18,
      padding: 15,
      borderWidth: 1,
      borderColor: theme.border,
      fontSize: 22,
      marginBottom: 14,
    },
    customEmojiActions: {
      flexDirection: "row",
      gap: 10,
    },
    modalCancelButton: {
      flex: 1,
      backgroundColor: theme.surface2,
      borderRadius: 18,
      padding: 14,
      alignItems: "center",
      borderWidth: 1,
      borderColor: theme.border,
    },
    modalCancelText: {
      color: theme.text,
      fontWeight: "900",
    },
    modalConfirmButton: {
      flex: 1,
      backgroundColor: theme.primary,
      borderRadius: 18,
      padding: 14,
      alignItems: "center",
    },
    modalConfirmText: {
      color: "#0B0D0C",
      fontWeight: "900",
    },
    stepWrap: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 18,
      backgroundColor: theme.surface,
      borderRadius: 22,
      padding: 12,
      borderWidth: 1,
      borderColor: theme.border,
    },
    stepItem: {
      alignItems: "center",
      flex: 1,
    },
    stepDot: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: theme.surface2,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.border,
    },
    stepDotActive: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    stepNumber: {
      color: theme.muted,
      fontWeight: "900",
      fontSize: 12,
    },
    stepNumberActive: {
      color: "#0B0D0C",
    },
    stepLabel: {
      color: theme.muted,
      fontSize: 11,
      fontWeight: "800",
      marginTop: 6,
    },
    stepLabelActive: {
      color: theme.text,
    },
    wizardButtons: {
      flexDirection: "row",
      gap: 10,
      marginBottom: 24,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: theme.primary,
      padding: 16,
      borderRadius: 20,
      alignItems: "center",
    },
    primaryButtonDisabled: {
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
    },
    primaryButtonText: {
      color: "#0B0D0C",
      fontSize: 16,
      fontWeight: "900",
    },
    primaryButtonTextDisabled: {
      color: theme.muted,
    },
    secondaryButton: {
      flex: 1,
      backgroundColor: theme.surface,
      padding: 16,
      borderRadius: 20,
      alignItems: "center",
      borderWidth: 1,
      borderColor: theme.border,
    },
    secondaryButtonText: {
      color: theme.text,
      fontSize: 16,
      fontWeight: "900",
    },
    cameraCaptureScreen: {
      flex: 1,
      backgroundColor: "#000000",
      padding: 16,
      justifyContent: "space-between",
    },
    cameraCaptureHeader: {
      paddingTop: 18,
      alignItems: "center",
    },
    cameraCaptureTitle: {
      color: "#FFFFFF",
      fontSize: 24,
      fontWeight: "900",
    },
    cameraCaptureText: {
      color: "rgba(255,255,255,0.72)",
      marginTop: 6,
      fontWeight: "700",
      textAlign: "center",
    },
    cameraFrame: {
      width: "100%",
      aspectRatio: 4 / 5,
      borderRadius: 28,
      overflow: "hidden",
      backgroundColor: "#111111",
      borderWidth: 2,
      borderColor: theme.primary,
    },
    cameraPreview: {
      flex: 1,
    },
    cameraControls: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingBottom: 26,
      paddingHorizontal: 4,
    },
    cameraCancelButton: {
      minWidth: 86,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 999,
      backgroundColor: "rgba(255,255,255,0.14)",
      alignItems: "center",
    },
    cameraCancelText: {
      color: "#FFFFFF",
      fontWeight: "900",
    },
    cameraControlSpacer: {
      width: 86,
    },
    captureButtonOuter: {
      width: 74,
      height: 74,
      borderRadius: 37,
      borderWidth: 4,
      borderColor: "#FFFFFF",
      alignItems: "center",
      justifyContent: "center",
    },
    captureButtonInner: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: "#FFFFFF",
    },
    scannerScreen: {
      flex: 1,
      backgroundColor: "#000000",
    },
    camera: {
      flex: 1,
    },
    scannerOverlay: {
      ...StyleSheet.absoluteFillObject,
      padding: 22,
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: "rgba(0,0,0,0.18)",
    },
    scannerTitle: {
      color: "#FFFFFF",
      fontSize: 28,
      fontWeight: "900",
      marginTop: 30,
    },
    scannerText: {
      color: "#FFFFFF",
      textAlign: "center",
      lineHeight: 20,
      maxWidth: 290,
      fontWeight: "700",
    },
    scanBox: {
      width: 290,
      height: 170,
      borderWidth: 3,
      borderColor: theme.primary,
      borderRadius: 22,
      backgroundColor: "rgba(0,0,0,0.08)",
    },
    scannerClose: {
      backgroundColor: "#FFFFFF",
      paddingHorizontal: 22,
      paddingVertical: 14,
      borderRadius: 999,
      marginBottom: 26,
    },
    scannerCloseText: {
      color: "#111111",
      fontWeight: "900",
    },
    wizardCard: {
      backgroundColor: theme.surface,
      borderRadius: 30,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: 16,
    },
    cardTitle: {
      color: theme.text,
      fontSize: 24,
      fontWeight: "900",
      letterSpacing: -0.6,
    },
    cardHint: {
      color: theme.muted,
      lineHeight: 20,
      marginTop: 6,
      marginBottom: 16,
    },
    photoCompactCard: {
      backgroundColor: theme.surface2,
      borderRadius: 24,
      padding: 12,
      borderWidth: 1,
      borderColor: theme.border,
      flexDirection: "row",
      gap: 12,
      alignItems: "center",
    },
    photoThumbnail: {
      width: 82,
      aspectRatio: 4 / 5,
      borderRadius: 18,
      backgroundColor: theme.surface,
    },
    photoThumbnailEmpty: {
      width: 82,
      aspectRatio: 4 / 5,
      borderRadius: 18,
      backgroundColor: theme.surface,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: theme.border,
    },
    photoThumbnailIcon: {
      color: theme.primary,
      fontSize: 34,
      fontWeight: "300",
    },
    photoActionArea: {
      flex: 1,
    },
    photoStatus: {
      color: theme.text,
      fontSize: 17,
      fontWeight: "900",
    },
    photoSubtext: {
      color: theme.muted,
      marginTop: 3,
      marginBottom: 12,
      fontWeight: "700",
    },
    photoButtonRow: {
      flexDirection: "row",
      gap: 8,
    },
    compactPrimary: {
      backgroundColor: theme.primary,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 999,
    },
    compactPrimaryText: {
      color: "#0B0D0C",
      fontWeight: "900",
      fontSize: 12,
    },
    compactSecondary: {
      backgroundColor: theme.surface,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.border,
    },
    compactSecondaryText: {
      color: theme.text,
      fontWeight: "900",
      fontSize: 12,
    },
    scanButton: {
      backgroundColor: theme.primary,
      padding: 16,
      borderRadius: 20,
      alignItems: "center",
      marginBottom: 8,
    },
    scanButtonText: {
      color: "#0B0D0C",
      fontSize: 16,
      fontWeight: "900",
    },
    manualHint: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: "800",
      marginBottom: 10,
    },
    lookupText: {
      color: theme.muted,
      marginBottom: 8,
      fontWeight: "700",
    },
    inputLabel: {
      color: theme.text,
      fontWeight: "900",
      marginBottom: 8,
      marginTop: 6,
    },
    input: {
      backgroundColor: theme.input,
      color: theme.text,
      borderRadius: 18,
      padding: 15,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.border,
      fontSize: 16,
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 2,
    },
    chip: {
      backgroundColor: theme.surface2,
      borderColor: theme.border,
      borderWidth: 1,
      paddingHorizontal: 13,
      paddingVertical: 10,
      borderRadius: 999,
    },
    chipActive: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    chipText: {
      color: theme.muted,
      fontWeight: "900",
    },
    chipTextActive: {
      color: "#0B0D0C",
    },
    reviewSummaryCard: {
      backgroundColor: theme.surface2,
      borderRadius: 22,
      padding: 10,
      borderWidth: 1,
      borderColor: theme.border,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 12,
    },
    reviewThumbnail: {
      width: 68,
      aspectRatio: 4 / 5,
      borderRadius: 16,
      backgroundColor: theme.surface,
    },
    reviewTextWrap: {
      flex: 1,
    },
    reviewBrand: {
      color: theme.text,
      fontSize: 21,
      fontWeight: "900",
    },
    reviewFlavor: {
      color: theme.muted,
      fontSize: 15,
      fontWeight: "800",
      marginTop: 2,
    },
    reviewCategory: {
      alignSelf: "flex-start",
      color: theme.accent,
      fontSize: 12,
      fontWeight: "900",
      backgroundColor: theme.accentSoft,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      marginTop: 8,
      overflow: "hidden",
    },
    ratingHeaderRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8,
    },
    ratingSelected: {
      color: theme.primary,
      fontWeight: "900",
      marginTop: 6,
    },
    ratingGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      rowGap: 6,
      marginBottom: 8,
    },
    ratingBubble: {
      width: "18%",
      height: 36,
      borderRadius: 18,
      backgroundColor: theme.surface2,
      borderColor: theme.border,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    ratingBubbleActive: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    ratingBubbleText: {
      color: theme.muted,
      fontWeight: "900",
    },
    ratingBubbleTextActive: {
      color: "#0B0D0C",
    },
    ratingGuideRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    ratingGuideText: {
      color: theme.muted,
      fontSize: 12,
      fontWeight: "800",
    },
    captionInput: {
      minHeight: 92,
      textAlignVertical: "top",
      lineHeight: 22,
    },
    profileCard: {
      backgroundColor: theme.surface,
      borderRadius: 30,
      padding: 22,
      alignItems: "center",
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: 14,
    },
    avatar: {
      width: 92,
      height: 92,
      borderRadius: 46,
      backgroundColor: theme.primary,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: 12,
    },
    avatarText: {
      color: "#0B0D0C",
      fontSize: 40,
      fontWeight: "900",
    },
    profileName: {
      color: theme.text,
      fontSize: 26,
      fontWeight: "900",
    },
    profileHandle: {
      color: theme.muted,
      marginTop: 2,
      fontWeight: "800",
    },
    profileEmail: {
      color: theme.muted,
      marginTop: 4,
      marginBottom: 20,
      fontSize: 12,
      fontWeight: "700",
    },
    statsRow: {
      flexDirection: "row",
      gap: 10,
    },
    statBox: {
      backgroundColor: theme.surface2,
      padding: 14,
      borderRadius: 18,
      minWidth: 84,
      alignItems: "center",
      borderWidth: 1,
      borderColor: theme.border,
    },
    statBoxAccent: {
      backgroundColor: theme.accentSoft,
      padding: 14,
      borderRadius: 18,
      minWidth: 84,
      alignItems: "center",
      borderWidth: 1,
      borderColor: theme.border,
    },
    statNumber: {
      color: theme.text,
      fontSize: 24,
      fontWeight: "900",
    },
    statLabel: {
      color: theme.muted,
      marginTop: 2,
      fontWeight: "800",
    },
    crewCard: {
      backgroundColor: theme.surface,
      borderRadius: 28,
      padding: 16,
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: 14,
    },
    crewTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 10,
    },
    smallPillButton: {
      backgroundColor: theme.surface2,
      borderRadius: 999,
      paddingHorizontal: 13,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: theme.border,
    },
    smallPillText: {
      color: theme.text,
      fontWeight: "900",
      fontSize: 12,
    },
    crewAddRow: {
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
      marginBottom: 12,
    },
    crewInput: {
      flex: 1,
      backgroundColor: theme.input,
      color: theme.text,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderWidth: 1,
      borderColor: theme.border,
    },
    crewButton: {
      backgroundColor: theme.primary,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: 999,
    },
    crewButtonText: {
      color: "#0B0D0C",
      fontWeight: "900",
    },
    crewEmpty: {
      color: theme.muted,
      fontWeight: "700",
      lineHeight: 20,
    },
    crewListItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: theme.surface2,
      borderRadius: 18,
      padding: 12,
      marginTop: 8,
      borderWidth: 1,
      borderColor: theme.border,
    },
    crewName: {
      color: theme.text,
      fontWeight: "900",
      fontSize: 15,
    },
    crewHandle: {
      color: theme.muted,
      marginTop: 2,
      fontWeight: "700",
    },
    removeButton: {
      backgroundColor: theme.accentSoft,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    removeButtonText: {
      color: theme.accent,
      fontWeight: "900",
      fontSize: 12,
    },
    historyItem: {
      backgroundColor: theme.surface2,
      padding: 10,
      borderRadius: 20,
      marginTop: 8,
      borderWidth: 1,
      borderColor: theme.border,
      flexDirection: "row",
      gap: 12,
      alignItems: "center",
    },
    historyImage: {
      width: 72,
      aspectRatio: 4 / 5,
      borderRadius: 16,
      backgroundColor: theme.surface2,
    },
    historyPlaceholder: {
      width: 72,
      aspectRatio: 4 / 5,
      borderRadius: 16,
      backgroundColor: theme.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    historyText: {
      flex: 1,
    },
    historyDate: {
      color: theme.primary,
      fontWeight: "900",
      marginBottom: 4,
    },
    historyBev: {
      color: theme.text,
      fontSize: 17,
      fontWeight: "900",
    },
    historyFlavor: {
      color: theme.muted,
      marginTop: 2,
      fontWeight: "700",
    },
    historyRating: {
      color: theme.accent,
      marginTop: 8,
      fontWeight: "900",
    },
    signOutButton: {
      backgroundColor: theme.surface,
      borderRadius: 20,
      padding: 16,
      alignItems: "center",
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: 24,
    },
    signOutText: {
      color: theme.accent,
      fontWeight: "900",
      fontSize: 16,
    },
    bottomNav: {
      height: 76,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 22,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      backgroundColor: theme.tab,
    },
    navSideButton: {
      width: 110,
      alignItems: "center",
      paddingVertical: 12,
    },
    navText: {
      color: theme.muted,
      fontWeight: "900",
      fontSize: 15,
    },
    navTextActive: {
      color: theme.primary,
    },
    postNavButton: {
      width: 62,
      height: 62,
      borderRadius: 31,
      backgroundColor: theme.primary,
      alignItems: "center",
      justifyContent: "center",
      marginTop: -26,
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 12,
      elevation: 8,
      borderWidth: 4,
      borderColor: theme.tab,
    },
    postNavButtonActive: {
      transform: [{ scale: 1.05 }],
    },
    postNavPlus: {
      color: "#0B0D0C",
      fontSize: 38,
      fontWeight: "900",
      marginTop: -4,
    },
    toast: {
      position: "absolute",
      left: 20,
      right: 20,
      bottom: 92,
      backgroundColor: theme.text,
      borderRadius: 999,
      paddingVertical: 12,
      paddingHorizontal: 16,
      alignItems: "center",
      shadowColor: "#000",
      shadowOpacity: 0.22,
      shadowRadius: 12,
      elevation: 8,
      zIndex: 50,
    },
    toastText: {
      color: theme.bg,
      fontWeight: "900",
    },
  });
}
