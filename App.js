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
import { getTheme, layout, radius as r, spacing as s, typography as t } from "./designSystem";

const DEFAULT_REACTION = "👍";
const QUICK_REACTIONS = ["🔥", "💯", "😮", "🤢"];
const RATINGS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
const CATEGORIES = ["Energy", "Soda", "Coffee", "Water", "Other"];
const STEPS = ["Photo", "Scan", "Post"];

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

function normalizeHandle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24);
}

function safeHandle(value) {
  const cleaned = normalizeHandle(value);
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

function AvatarView({ uri, name, size = 44, theme }) {
  const letter = (String(name || "B").trim()[0] || "B").toUpperCase();

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.surface2,
        }}
      />
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.primary,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#0B0D0C", fontWeight: "900", fontSize: size * 0.42 }}>
        {letter}
      </Text>
    </View>
  );
}

function PinchZoomImage({ uri, styles }) {
  const pinchScale = useRef(new Animated.Value(1)).current;

  const displayScale = pinchScale.interpolate({
    inputRange: [1, 2, 4],
    outputRange: [1, 1.32, 1.9],
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
        friction: 8,
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
  const theme = getTheme(themeMode);
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

  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editHandle, setEditHandle] = useState("");
  const [editAvatarUri, setEditAvatarUri] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  const [activeTab, setActiveTab] = useState("Feed");
  const [feedMode, setFeedMode] = useState("crew");
  const [posts, setPosts] = useState([]);
  const [discoverProfiles, setDiscoverProfiles] = useState([]);
  const [discoverSearch, setDiscoverSearch] = useState("");
  const [discoverLoading, setDiscoverLoading] = useState(false);
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
  const profileDisplayName = profile?.display_name || deriveNameFromEmail(user?.email || "bev user");
  const profileHandle = profile?.handle || safeHandle(user?.email?.split("@")[0] || profileDisplayName);
  const crewIds = new Set(crewMembers.map((member) => member.id));
  const crewUserIds = new Set([user?.id, ...crewMembers.map((member) => member.id)]);
  const myPosts = posts.filter((post) =>
    post.userId ? post.userId === user?.id : post.user === profileDisplayName
  );
  const crewPosts = posts.filter((post) => {
    if (post.userId) return crewUserIds.has(post.userId);
    return post.user === profileDisplayName;
  });

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
        resetSignedOutState();
      }
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe?.();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!profile) return;
    setEditDisplayName(profile.display_name || "");
    setEditHandle(profile.handle || "");
    setEditAvatarUri(profile.avatar_url || "");
  }, [profile?.id, profile?.display_name, profile?.handle, profile?.avatar_url]);

  useEffect(() => {
    if (!user || feedMode !== "explore") return;

    const timer = setTimeout(() => {
      loadDiscoverProfiles(discoverSearch);
    }, 250);

    return () => clearTimeout(timer);
  }, [user?.id, feedMode, discoverSearch, crewMembers.length]);

  function resetSignedOutState() {
    setProfile(null);
    setCrewMembers([]);
    setPosts([]);
    setDiscoverProfiles([]);
    setLoading(false);
    setAuthChecking(false);
    setActiveTab("Feed");
    resetPostFlow();
  }

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
      await loadCrew(authUser.id);
      await loadPosts();
      await loadDiscoverProfiles("");
    } catch (error) {
      Alert.alert(
        "Setup needed",
        error.message || "Could not load your account. Make sure the Supabase SQL setup has been run."
      );
    }

    setLoading(false);
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
    const baseHandle = safeHandle(
      authUser.user_metadata?.handle || authUser.email?.split("@")[0] || displayName
    );

    let response = await supabase
      .from("profiles")
      .insert({ id: authUser.id, display_name: displayName, handle: baseHandle })
      .select("*")
      .single();

    if (response.error?.code === "23505") {
      const retryProfile = await fetchProfileById(authUser.id);

      if (retryProfile) {
        setProfile(retryProfile);
        return retryProfile;
      }

      response = await supabase
        .from("profiles")
        .insert({
          id: authUser.id,
          display_name: displayName,
          handle: `${baseHandle}${Math.floor(100 + Math.random() * 900)}`.slice(0, 24),
        })
        .select("*")
        .single();
    }

    if (response.error) throw response.error;

    setProfile(response.data);
    return response.data;
  }

  async function loadCrew(currentUserId = user?.id) {
    if (!currentUserId) return [];

    const { data, error } = await supabase
      .from("crew_memberships")
      .select("member_id, profiles!crew_memberships_member_id_fkey(id, display_name, handle, avatar_url)")
      .eq("owner_id", currentUserId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const members = (data || []).map((row) => row.profiles).filter(Boolean);
    setCrewMembers(members);
    return members;
  }

  async function loadDiscoverProfiles(searchText = discoverSearch) {
    if (!user?.id) return;

    setDiscoverLoading(true);

    try {
      const cleanedSearch = String(searchText || "")
        .trim()
        .replace(/[%(),]/g, "")
        .slice(0, 32);

      let query = supabase
        .from("profiles")
        .select("id, display_name, handle, avatar_url, created_at")
        .neq("id", user.id)
        .order("created_at", { ascending: false })
        .limit(30);

      if (cleanedSearch) {
        query = query.or(`display_name.ilike.%${cleanedSearch}%,handle.ilike.%${cleanedSearch}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      setDiscoverProfiles(data || []);
    } catch (error) {
      Alert.alert("Explore error", error.message || "Could not load people.");
    }

    setDiscoverLoading(false);
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

  async function handleAuthSubmit() {
    const cleanEmail = authEmail.trim();
    const cleanPassword = authPassword.trim();
    const cleanDisplayName = authDisplayName.trim();
    const cleanHandle = safeHandle(authHandle || cleanDisplayName || cleanEmail.split("@")[0]);
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
          setAuthMode("login");
          showToast("Check your email to confirm");
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
    resetSignedOutState();
  }

  async function uploadImageToSupabase(uri, prefix = "bev") {
    const fileExt = uri.split(".").pop()?.split("?")[0] || "jpg";
    const contentType = fileExt.toLowerCase() === "png" ? "image/png" : "image/jpeg";
    const fileName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
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

  async function pickAvatarImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert("Permission needed", "Photo access is needed to pick a profile photo.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (!result.canceled) setEditAvatarUri(result.assets[0].uri);
  }

  async function saveProfileEdits() {
    if (!user) return;

    const cleanName = editDisplayName.trim();
    const cleanHandle = normalizeHandle(editHandle);

    if (!cleanName) {
      Alert.alert("Missing name", "Add a display name.");
      return;
    }

    if (cleanHandle.length < 3) {
      Alert.alert("Handle too short", "Use at least 3 letters, numbers, or underscores.");
      return;
    }

    setProfileSaving(true);

    try {
      let avatarUrl = editAvatarUri || null;

      if (editAvatarUri && editAvatarUri !== profile?.avatar_url && !editAvatarUri.startsWith("http")) {
        avatarUrl = await uploadImageToSupabase(editAvatarUri, "avatar");
      }

      const { data, error } = await supabase
        .from("profiles")
        .update({
          display_name: cleanName,
          handle: cleanHandle,
          avatar_url: avatarUrl,
        })
        .eq("id", user.id)
        .select("*")
        .single();

      if (error) throw error;

      await supabase
        .from("posts")
        .update({ user_name: cleanName })
        .eq("user_id", user.id);

      setProfile(data);
      setEditProfileOpen(false);
      await loadPosts();
      showToast("Profile updated");
    } catch (error) {
      if (error.code === "23505") {
        Alert.alert("Handle taken", "Try a different handle.");
      } else {
        Alert.alert("Profile error", error.message || "Could not update your profile.");
      }
    }

    setProfileSaving(false);
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
    if (postStep < STEPS.length - 1) setPostStep(postStep + 1);
  }

  async function postBev() {
    if (!isStepReady(2) || !user) {
      Alert.alert("Missing info", "Add the photo, drink details, and rating first.");
      return;
    }

    setSaving(true);

    try {
      const uploadedImageUrl = await uploadImageToSupabase(imageUri, "bev");

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

  async function addCrewMemberByProfile(memberProfile) {
    if (!memberProfile?.id || !user) return;

    if (memberProfile.id === user.id) {
      showToast("That is you");
      return;
    }

    if (crewIds.has(memberProfile.id)) {
      showToast("Already in crew");
      return;
    }

    const { error } = await supabase.from("crew_memberships").insert({
      owner_id: user.id,
      member_id: memberProfile.id,
    });

    if (error && error.code !== "23505") {
      Alert.alert("Crew error", error.message);
      return;
    }

    await loadCrew(user.id);
    await loadDiscoverProfiles(discoverSearch);
    showToast(error?.code === "23505" ? "Already in crew" : "Added to crew");
  }

  async function addCrewMember() {
    const handle = normalizeHandle(crewHandleDraft);
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

    await addCrewMemberByProfile(foundProfile);
    setCrewHandleDraft("");
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
    await loadDiscoverProfiles(discoverSearch);
    await loadPosts();
    showToast("Removed from crew");
  }

  function renderButton(label, onPress, options = {}) {
    const { disabled = false, variant = "primary", style } = options;

    return (
      <TouchableOpacity
        style={[
          styles.button,
          variant === "primary" ? styles.buttonPrimary : styles.buttonSecondary,
          disabled && styles.buttonDisabled,
          style,
        ]}
        onPress={onPress}
        disabled={disabled}
      >
        <Text
          style={[
            styles.buttonText,
            variant === "primary" ? styles.buttonTextPrimary : styles.buttonTextSecondary,
            disabled && styles.buttonTextDisabled,
          ]}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
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

          <View style={styles.card}>
            <Text style={styles.screenTitle}>{isSignup ? "Create account" : "Log in"}</Text>

            <View style={styles.segmentedControl}>
              <TouchableOpacity
                style={[styles.segmentButton, !isSignup && styles.segmentButtonActive]}
                onPress={() => setAuthMode("login")}
              >
                <Text style={[styles.segmentText, !isSignup && styles.segmentTextActive]}>Login</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.segmentButton, isSignup && styles.segmentButtonActive]}
                onPress={() => setAuthMode("signup")}
              >
                <Text style={[styles.segmentText, isSignup && styles.segmentTextActive]}>Signup</Text>
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

            {renderButton(authSaving ? "Working..." : isSignup ? "Create account" : "Log in", handleAuthSubmit, {
              disabled: authSaving,
            })}

            <Text style={styles.authFooterText}>
              {isSignup ? "Already have an account? Tap Login." : "New here? Tap Signup."}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  function renderFeedModeTabs() {
    return (
      <View style={styles.segmentedControl}>
        {[
          ["crew", "Crew"],
          ["explore", "Explore"],
        ].map(([value, label]) => (
          <TouchableOpacity
            key={value}
            style={[styles.segmentButton, feedMode === value && styles.segmentButtonActive]}
            onPress={() => setFeedMode(value)}
          >
            <Text style={[styles.segmentText, feedMode === value && styles.segmentTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
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
        {feedMode === "crew" ? renderCrewFeed() : renderExploreFeed()}
      </ScrollView>
    );
  }

  function renderCrewFeed() {
    return (
      <>
        <View style={styles.heroCard}>
          <View style={styles.heroTextWrap}>
            <Text style={styles.heroTitle}>Crew Feed</Text>
            <Text style={styles.heroText}>Posts from you and your crew.</Text>
          </View>

          <TouchableOpacity style={styles.heroButton} onPress={() => setActiveTab("Post")}>
            <Text style={styles.heroButtonText}>Post</Text>
          </TouchableOpacity>
        </View>

        {crewPosts.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>No crew posts yet</Text>
            <Text style={styles.mutedText}>Post a drink or add someone by handle.</Text>
          </View>
        ) : null}

        {crewPosts.map((post) => renderPostCard(post))}
      </>
    );
  }

  function renderExploreFeed() {
    const publicPosts = posts.slice(0, 12);

    return (
      <>
        <View style={styles.heroCard}>
          <View style={styles.heroTextWrap}>
            <Text style={styles.heroTitle}>Explore</Text>
            <Text style={styles.heroText}>Find people, add crew, and see what everyone is drinking.</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Find people</Text>
          <Text style={styles.cardHint}>Search by name or handle.</Text>

          <View style={styles.exploreSearchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="search handles"
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              value={discoverSearch}
              onChangeText={setDiscoverSearch}
            />
            <TouchableOpacity style={styles.crewButton} onPress={() => loadDiscoverProfiles(discoverSearch)}>
              <Text style={styles.crewButtonText}>Search</Text>
            </TouchableOpacity>
          </View>

          {discoverLoading ? (
            <View style={styles.inlineLoading}>
              <ActivityIndicator color={theme.primary} />
              <Text style={styles.mutedText}>Searching...</Text>
            </View>
          ) : null}

          {!discoverLoading && discoverProfiles.length === 0 ? (
            <Text style={styles.mutedText}>No people found yet.</Text>
          ) : null}

          {discoverProfiles.map((person) => {
            const inCrew = crewIds.has(person.id);

            return (
              <View key={person.id} style={styles.profileListItem}>
                <View style={styles.userRow}>
                  <AvatarView uri={person.avatar_url} name={person.display_name} theme={theme} size={44} />
                  <View style={styles.profileListText}>
                    <Text style={styles.crewName}>{person.display_name}</Text>
                    <Text style={styles.crewHandle}>@{person.handle}</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.smallActionButton, inCrew && styles.smallActionButtonMuted]}
                  onPress={() => addCrewMemberByProfile(person)}
                  disabled={inCrew}
                >
                  <Text style={[styles.smallActionText, inCrew && styles.smallActionTextMuted]}>
                    {inCrew ? "In crew" : "Add"}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>Public bev feed</Text>
        {publicPosts.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.mutedText}>No public posts yet.</Text>
          </View>
        ) : null}
        {publicPosts.map((post) => renderPostCard(post))}
      </>
    );
  }

  function renderPostCard(post) {
    const visibleReactions = getVisibleReactionEntries(post.reactions);

    return (
      <View key={post.id} style={styles.postCard}>
        <View style={styles.cardTop}>
          <View style={styles.userRow}>
            <AvatarView uri={null} name={post.user} theme={theme} size={40} />
            <View>
              <Text style={styles.username}>{post.user}</Text>
              <Text style={styles.metaText}>{post.date}</Text>
            </View>
          </View>

          <View style={styles.categoryPill}>
            <Text style={styles.categoryPillText}>{post.category}</Text>
          </View>
        </View>

        {post.imageUri ? (
          <PinchZoomImage uri={post.imageUri} styles={styles} />
        ) : (
          <View style={styles.placeholderPortrait}>
            <Text style={styles.mutedText}>4:5 bev photo</Text>
          </View>
        )}

        <Text style={styles.bevName}>{post.brand}</Text>
        <Text style={styles.flavorName}>{post.flavor}</Text>
        <Text style={styles.ratingText}>Rating: {formatRating(post.rating)}</Text>

        {post.caption ? <Text style={styles.caption}>{post.caption}</Text> : null}

        <ScrollView
          horizontal
          style={styles.reactionScroll}
          contentContainerStyle={styles.reactionScrollContent}
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            style={styles.reactionButton}
            onPress={() => handleDefaultReactionPress(post.id)}
            onLongPress={() => openReactionPicker(post.id)}
            delayLongPress={300}
          >
            <Text style={styles.reactionText}>
              {DEFAULT_REACTION} {post.reactions?.[DEFAULT_REACTION] || 0}
            </Text>
          </TouchableOpacity>

          {visibleReactions.map(([emoji, count]) => (
            <TouchableOpacity
              key={emoji}
              style={styles.reactionButton}
              onPress={() => reactToPost(post.id, emoji)}
            >
              <Text style={styles.reactionText}>
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
            onChangeText={(text) => setCommentDrafts({ ...commentDrafts, [post.id]: text })}
          />

          <TouchableOpacity style={styles.commentButton} onPress={() => addComment(post.id)}>
            <Text style={styles.commentButtonText}>➤</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  function renderStepHeader() {
    return (
      <View style={styles.stepWrap}>
        {STEPS.map((step, index) => (
          <View key={step} style={styles.stepItem}>
            <View style={[styles.stepDot, index <= postStep && styles.stepDotActive]}>
              <Text style={[styles.stepNumber, index <= postStep && styles.stepNumberActive]}>
                {index + 1}
              </Text>
            </View>
            <Text style={[styles.stepLabel, index === postStep && styles.stepLabelActive]}>{step}</Text>
          </View>
        ))}
      </View>
    );
  }

  function renderPostButtons() {
    const primaryDisabled = saving || !isStepReady();

    return (
      <View style={styles.buttonRow}>
        {renderButton(postStep > 0 ? "Back" : "Clear", postStep > 0 ? () => setPostStep(postStep - 1) : resetPostFlow, {
          variant: "secondary",
          disabled: saving,
          style: styles.flexButton,
        })}

        {renderButton(postStep < STEPS.length - 1 ? "Next" : saving ? "Posting..." : "Post Bev", postStep < STEPS.length - 1 ? goNext : postBev, {
          disabled: primaryDisabled,
          style: styles.flexButton,
        })}
      </View>
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
            <TouchableOpacity style={styles.cameraCancelButton} onPress={() => setCustomCameraOpen(false)}>
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
            style={styles.cameraPreview}
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

          {postStep === 0 && renderPhotoStep()}
          {postStep === 1 && renderDetailsStep()}
          {postStep === 2 && renderRatingStep()}

          {renderPostButtons()}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  function renderPhotoStep() {
    return (
      <View style={styles.card}>
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

            <View style={styles.compactButtonRow}>
              <TouchableOpacity style={styles.compactPrimary} onPress={takePhoto}>
                <Text style={styles.compactPrimaryText}>{imageUri ? "Retake" : "Take photo"}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.compactSecondary} onPress={pickImage}>
                <Text style={styles.compactSecondaryText}>Library</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    );
  }

  function renderDetailsStep() {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Drink details</Text>
        <Text style={styles.cardHint}>Scan it, or type it manually.</Text>

        {renderButton("Scan barcode", startScanner)}

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
          {CATEGORIES.map((item) => (
            <TouchableOpacity
              key={item}
              style={[styles.chip, category === item && styles.chipActive]}
              onPress={() => setCategory(item)}
            >
              <Text style={[styles.chipText, category === item && styles.chipTextActive]}>{item}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  function renderRatingStep() {
    return (
      <View style={styles.card}>
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
              <Text style={[styles.ratingBubbleText, rating === num && styles.ratingBubbleTextActive]}>
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
    );
  }

  function renderProfile() {
    return (
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.screenTitle}>Profile</Text>
        <Text style={styles.screenSubtitle}>Your bev stats and crew.</Text>

        <View style={styles.profileCard}>
          <AvatarView uri={profile?.avatar_url} name={profileDisplayName} theme={theme} size={96} />

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

          <View style={styles.profileActionRow}>
            {renderButton("Edit Profile", () => setEditProfileOpen(true), { style: styles.flexButton })}
          </View>
        </View>

        {renderHistoryPreview()}
        {renderCrewCard()}

        <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  function renderHistoryPreview() {
    return (
      <View style={styles.card}>
        <View style={styles.sectionHeader}>
          <Text style={styles.cardTitle}>History</Text>
          <TouchableOpacity style={styles.smallPillButton} onPress={() => setHistoryOpen(!historyOpen)}>
            <Text style={styles.smallPillText}>{historyOpen ? "Hide" : "Show"}</Text>
          </TouchableOpacity>
        </View>

        {!historyOpen ? (
          <Text style={styles.mutedText}>Your past drinks live here now.</Text>
        ) : myPosts.length === 0 ? (
          <Text style={styles.mutedText}>No posts yet.</Text>
        ) : (
          myPosts.map((post) => (
            <View key={post.id} style={styles.historyItem}>
              {post.imageUri ? (
                <Image source={{ uri: post.imageUri }} style={styles.historyImage} />
              ) : (
                <View style={styles.historyPlaceholder}>
                  <Text style={styles.mutedText}>no photo</Text>
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

  function renderCrewCard() {
    return (
      <View style={styles.card}>
        <View style={styles.sectionHeader}>
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
            style={[styles.crewButton, crewSaving && styles.buttonDisabled]}
            onPress={addCrewMember}
            disabled={crewSaving}
          >
            <Text style={styles.crewButtonText}>Add</Text>
          </TouchableOpacity>
        </View>

        {crewMembers.length === 0 ? (
          <Text style={styles.mutedText}>Add someone’s handle to see their posts.</Text>
        ) : null}

        {crewMembers.map((member) => (
          <View key={member.id} style={styles.crewListItem}>
            <View style={styles.userRow}>
              <AvatarView uri={member.avatar_url} name={member.display_name} theme={theme} size={40} />
              <View>
                <Text style={styles.crewName}>{member.display_name}</Text>
                <Text style={styles.crewHandle}>@{member.handle}</Text>
              </View>
            </View>

            <TouchableOpacity style={styles.removeButton} onPress={() => removeCrewMember(member.id)}>
              <Text style={styles.removeButtonText}>Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
    );
  }

  function renderProfileEditor() {
    return (
      <Modal visible={editProfileOpen} transparent animationType="fade" onRequestClose={() => setEditProfileOpen(false)}>
        <View style={styles.pickerBackdrop}>
          <TouchableOpacity
            style={styles.pickerBackdropPressTarget}
            activeOpacity={1}
            onPress={() => setEditProfileOpen(false)}
          />

          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.editProfileCard}
          >
            <Text style={styles.cardTitle}>Edit Profile</Text>
            <Text style={styles.cardHint}>Change your photo, name, or handle.</Text>

            <View style={styles.editAvatarRow}>
              <AvatarView uri={editAvatarUri} name={editDisplayName} theme={theme} size={78} />
              <TouchableOpacity style={styles.smallActionButton} onPress={pickAvatarImage}>
                <Text style={styles.smallActionText}>Change photo</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Display name</Text>
            <TextInput
              style={styles.input}
              value={editDisplayName}
              onChangeText={setEditDisplayName}
              placeholder="Display name"
              placeholderTextColor={theme.muted}
            />

            <Text style={styles.inputLabel}>Handle</Text>
            <TextInput
              style={styles.input}
              value={editHandle}
              onChangeText={setEditHandle}
              placeholder="handle"
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
            />

            <View style={styles.buttonRow}>
              {renderButton("Cancel", () => setEditProfileOpen(false), {
                variant: "secondary",
                style: styles.flexButton,
                disabled: profileSaving,
              })}
              {renderButton(profileSaving ? "Saving..." : "Save", saveProfileEdits, {
                style: styles.flexButton,
                disabled: profileSaving,
              })}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
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
            <Text style={styles.cardTitle}>Choose emoji</Text>
            <TextInput
              style={styles.customEmojiInput}
              value={customEmojiInput}
              onChangeText={setCustomEmojiInput}
              placeholder="emoji"
              placeholderTextColor={theme.muted}
              autoFocus
              maxLength={8}
            />

            <View style={styles.buttonRow}>
              {renderButton("Cancel", closeCustomEmojiPicker, { variant: "secondary", style: styles.flexButton })}
              {renderButton("React", addCustomReaction, { style: styles.flexButton })}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    );
  }

  function renderBottomNav() {
    return (
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navSideButton} onPress={() => setActiveTab("Feed")}>
          <Text style={[styles.navText, activeTab === "Feed" && styles.navTextActive]}>Feed</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.postNavButton, activeTab === "Post" && styles.postNavButtonActive]}
          onPress={() => setActiveTab("Post")}
        >
          <Text style={styles.postNavPlus}>＋</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navSideButton} onPress={() => setActiveTab("Profile")}>
          <Text style={[styles.navText, activeTab === "Profile" && styles.navTextActive]}>Profile</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderToast() {
    return toastMessage ? (
      <View style={styles.toast} pointerEvents="none">
        <Text style={styles.toastText}>{toastMessage}</Text>
      </View>
    ) : null;
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
        {renderProfileEditor()}
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
    content: {
      flex: 1,
      padding: layout.pagePadding,
    },
    loadingScreen: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: s.md,
    },
    loadingText: {
      color: theme.muted,
      fontWeight: "800",
    },
    authScreen: {
      flex: 1,
      padding: layout.pagePadding,
    },
    authScroll: {
      flexGrow: 1,
      justifyContent: "center",
      paddingVertical: s.xxxl,
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
      marginTop: s.xs,
      marginBottom: s.xxl,
      fontWeight: "700",
    },
    authFooterText: {
      color: theme.muted,
      textAlign: "center",
      marginTop: s.lg,
      fontWeight: "700",
    },
    header: {
      paddingHorizontal: s.xl,
      paddingTop: s.lg,
      paddingBottom: s.lg,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      backgroundColor: theme.bg,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    logo: {
      color: theme.text,
      fontSize: t.logo,
      fontWeight: "900",
      letterSpacing: -1.5,
    },
    subtitle: {
      color: theme.muted,
      fontSize: t.small,
      marginTop: s.xs,
    },
    themeButton: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      paddingHorizontal: s.lg,
      paddingVertical: s.sm + 1,
      borderRadius: r.pill,
    },
    themeButtonText: {
      color: theme.text,
      fontWeight: "800",
      fontSize: t.tiny,
    },
    screenTitle: {
      color: theme.text,
      fontSize: t.screen,
      fontWeight: "900",
      letterSpacing: -0.8,
      marginBottom: s.xs,
    },
    screenSubtitle: {
      color: theme.muted,
      fontSize: 14,
      marginBottom: s.xl,
    },
    card: {
      backgroundColor: theme.surface,
      borderRadius: r.card,
      padding: layout.cardPadding,
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: s.lg,
    },
    cardTitle: {
      color: theme.text,
      fontSize: t.cardTitle,
      fontWeight: "900",
      letterSpacing: -0.5,
    },
    cardHint: {
      color: theme.muted,
      lineHeight: 20,
      marginTop: s.xs,
      marginBottom: s.lg,
      fontWeight: "700",
    },
    mutedText: {
      color: theme.muted,
      fontWeight: "700",
      lineHeight: 20,
    },
    metaText: {
      color: theme.muted,
      marginTop: 2,
      fontWeight: "700",
    },
    sectionLabel: {
      color: theme.text,
      fontSize: 17,
      fontWeight: "900",
      marginBottom: s.md,
    },
    heroCard: {
      backgroundColor: theme.primarySoft,
      borderRadius: r.card,
      padding: s.xl,
      marginBottom: s.lg,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderWidth: 1,
      borderColor: theme.border,
      gap: s.md,
    },
    heroTextWrap: {
      flex: 1,
      paddingRight: s.sm,
    },
    heroTitle: {
      color: theme.text,
      fontSize: t.cardTitle,
      fontWeight: "900",
      letterSpacing: -0.7,
    },
    heroText: {
      color: theme.muted,
      marginTop: s.xs,
      lineHeight: 20,
      fontWeight: "700",
    },
    heroButton: {
      minHeight: layout.buttonHeight,
      backgroundColor: theme.primary,
      paddingHorizontal: s.xl,
      borderRadius: r.pill,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    heroButtonText: {
      color: "#0B0D0C",
      fontWeight: "900",
      fontSize: t.body,
    },
    segmentedControl: {
      flexDirection: "row",
      backgroundColor: theme.surface,
      padding: 5,
      borderRadius: r.pill,
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: s.lg,
    },
    segmentButton: {
      flex: 1,
      minHeight: 42,
      borderRadius: r.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    segmentButtonActive: {
      backgroundColor: theme.primary,
    },
    segmentText: {
      color: theme.muted,
      fontWeight: "900",
    },
    segmentTextActive: {
      color: "#0B0D0C",
    },
    button: {
      minHeight: layout.buttonHeight,
      borderRadius: r.lg,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: s.lg,
    },
    buttonPrimary: {
      backgroundColor: theme.primary,
    },
    buttonSecondary: {
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
    },
    buttonDisabled: {
      backgroundColor: theme.surface2,
      borderWidth: 1,
      borderColor: theme.border,
      opacity: 0.72,
    },
    buttonText: {
      fontSize: t.body,
      fontWeight: "900",
    },
    buttonTextPrimary: {
      color: "#0B0D0C",
    },
    buttonTextSecondary: {
      color: theme.text,
    },
    buttonTextDisabled: {
      color: theme.muted,
    },
    flexButton: {
      flex: 1,
    },
    buttonRow: {
      flexDirection: "row",
      gap: s.md,
      marginBottom: s.xxl,
    },
    inputLabel: {
      color: theme.text,
      fontWeight: "900",
      marginBottom: s.sm,
      marginTop: s.xs,
    },
    input: {
      backgroundColor: theme.input,
      color: theme.text,
      borderRadius: r.lg,
      paddingHorizontal: s.lg,
      minHeight: layout.buttonHeight,
      marginBottom: s.md,
      borderWidth: 1,
      borderColor: theme.border,
      fontSize: t.body,
    },
    postCard: {
      backgroundColor: theme.surface,
      borderRadius: r.card,
      padding: s.lg,
      marginBottom: s.xl,
      borderWidth: 1,
      borderColor: theme.border,
    },
    cardTop: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: s.md,
      gap: s.sm,
    },
    userRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: s.md,
      flex: 1,
    },
    username: {
      color: theme.text,
      fontSize: t.body,
      fontWeight: "900",
    },
    categoryPill: {
      backgroundColor: theme.accentSoft,
      borderRadius: r.pill,
      paddingHorizontal: s.md,
      paddingVertical: s.sm,
    },
    categoryPillText: {
      color: theme.accent,
      fontWeight: "900",
      fontSize: t.tiny,
    },
    postImageFrame: {
      width: "100%",
      aspectRatio: layout.photoRatio,
      borderRadius: r.xl,
      marginBottom: s.lg,
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
      aspectRatio: layout.photoRatio,
      backgroundColor: theme.surface2,
      borderRadius: r.xl,
      justifyContent: "center",
      alignItems: "center",
      marginBottom: s.lg,
      borderWidth: 1,
      borderColor: theme.border,
    },
    bevName: {
      color: theme.text,
      fontSize: t.cardTitle,
      fontWeight: "900",
      letterSpacing: -0.4,
    },
    flavorName: {
      color: theme.muted,
      fontSize: t.body,
      fontWeight: "700",
      marginTop: 2,
      marginBottom: s.sm,
    },
    ratingText: {
      color: theme.primary,
      fontWeight: "900",
      marginBottom: s.md,
    },
    caption: {
      color: theme.text,
      lineHeight: 20,
      backgroundColor: theme.surface2,
      padding: s.md,
      borderRadius: r.md,
      overflow: "hidden",
      marginBottom: s.md,
    },
    reactionScroll: {
      marginBottom: s.md,
      marginHorizontal: -2,
    },
    reactionScrollContent: {
      alignItems: "center",
      gap: s.sm,
      paddingHorizontal: 2,
      paddingRight: s.md,
    },
    reactionButton: {
      backgroundColor: theme.surface2,
      paddingHorizontal: s.md,
      paddingVertical: s.sm + 1,
      borderRadius: r.pill,
      borderWidth: 1,
      borderColor: theme.border,
    },
    reactionText: {
      color: theme.text,
      fontWeight: "900",
      fontSize: 14,
    },
    commentsBox: {
      backgroundColor: theme.surface2,
      borderRadius: r.md,
      padding: s.md,
      marginBottom: s.md,
    },
    commentText: {
      color: theme.text,
      lineHeight: 20,
      marginBottom: s.xs,
    },
    commentUser: {
      fontWeight: "900",
      color: theme.primary,
    },
    commentRow: {
      flexDirection: "row",
      gap: s.sm,
      alignItems: "center",
    },
    commentInput: {
      flex: 1,
      minHeight: 44,
      backgroundColor: theme.input,
      color: theme.text,
      borderRadius: r.pill,
      paddingHorizontal: s.lg,
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
    exploreSearchRow: {
      flexDirection: "row",
      gap: s.sm,
      alignItems: "center",
      marginBottom: s.md,
    },
    searchInput: {
      flex: 1,
      minHeight: 44,
      backgroundColor: theme.input,
      color: theme.text,
      borderRadius: r.pill,
      paddingHorizontal: s.lg,
      borderWidth: 1,
      borderColor: theme.border,
    },
    inlineLoading: {
      flexDirection: "row",
      alignItems: "center",
      gap: s.sm,
      marginBottom: s.md,
    },
    profileListItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: theme.surface2,
      borderRadius: r.lg,
      padding: s.md,
      marginTop: s.sm,
      borderWidth: 1,
      borderColor: theme.border,
      gap: s.md,
    },
    profileListText: {
      flex: 1,
    },
    smallActionButton: {
      backgroundColor: theme.primary,
      borderRadius: r.pill,
      paddingHorizontal: s.md,
      minHeight: 38,
      alignItems: "center",
      justifyContent: "center",
    },
    smallActionButtonMuted: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
    },
    smallActionText: {
      color: "#0B0D0C",
      fontWeight: "900",
      fontSize: t.tiny,
    },
    smallActionTextMuted: {
      color: theme.muted,
    },
    stepWrap: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: s.lg,
      backgroundColor: theme.surface,
      borderRadius: r.xl,
      padding: s.md,
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
      fontSize: t.tiny,
    },
    stepNumberActive: {
      color: "#0B0D0C",
    },
    stepLabel: {
      color: theme.muted,
      fontSize: 11,
      fontWeight: "800",
      marginTop: s.sm,
    },
    stepLabelActive: {
      color: theme.text,
    },
    photoCompactCard: {
      backgroundColor: theme.surface2,
      borderRadius: r.xl,
      padding: s.md,
      borderWidth: 1,
      borderColor: theme.border,
      flexDirection: "row",
      gap: s.md,
      alignItems: "center",
    },
    photoThumbnail: {
      width: 82,
      aspectRatio: layout.photoRatio,
      borderRadius: r.md,
      backgroundColor: theme.surface,
    },
    photoThumbnailEmpty: {
      width: 82,
      aspectRatio: layout.photoRatio,
      borderRadius: r.md,
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
      marginBottom: s.md,
      fontWeight: "700",
    },
    compactButtonRow: {
      flexDirection: "row",
      gap: s.sm,
    },
    compactPrimary: {
      backgroundColor: theme.primary,
      paddingHorizontal: s.md,
      paddingVertical: s.sm + 2,
      borderRadius: r.pill,
    },
    compactPrimaryText: {
      color: "#0B0D0C",
      fontWeight: "900",
      fontSize: t.tiny,
    },
    compactSecondary: {
      backgroundColor: theme.surface,
      paddingHorizontal: s.md,
      paddingVertical: s.sm + 2,
      borderRadius: r.pill,
      borderWidth: 1,
      borderColor: theme.border,
    },
    compactSecondaryText: {
      color: theme.text,
      fontWeight: "900",
      fontSize: t.tiny,
    },
    manualHint: {
      color: theme.muted,
      fontSize: t.tiny,
      fontWeight: "800",
      marginTop: s.sm,
      marginBottom: s.md,
    },
    lookupText: {
      color: theme.muted,
      marginBottom: s.sm,
      fontWeight: "700",
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: s.sm,
      marginTop: 2,
    },
    chip: {
      backgroundColor: theme.surface2,
      borderColor: theme.border,
      borderWidth: 1,
      paddingHorizontal: s.md,
      paddingVertical: s.sm + 1,
      borderRadius: r.pill,
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
      borderRadius: r.lg,
      padding: s.md,
      borderWidth: 1,
      borderColor: theme.border,
      flexDirection: "row",
      alignItems: "center",
      gap: s.md,
      marginBottom: s.md,
    },
    reviewThumbnail: {
      width: 68,
      aspectRatio: layout.photoRatio,
      borderRadius: r.md,
      backgroundColor: theme.surface,
    },
    reviewTextWrap: {
      flex: 1,
    },
    reviewBrand: {
      color: theme.text,
      fontSize: t.title,
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
      fontSize: t.tiny,
      fontWeight: "900",
      backgroundColor: theme.accentSoft,
      paddingHorizontal: s.md,
      paddingVertical: s.xs + 1,
      borderRadius: r.pill,
      marginTop: s.sm,
      overflow: "hidden",
    },
    ratingHeaderRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: s.sm,
    },
    ratingSelected: {
      color: theme.primary,
      fontWeight: "900",
    },
    ratingGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      rowGap: s.sm,
      marginBottom: s.sm,
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
      marginBottom: s.md,
    },
    ratingGuideText: {
      color: theme.muted,
      fontSize: t.tiny,
      fontWeight: "800",
    },
    captionInput: {
      minHeight: 92,
      textAlignVertical: "top",
      lineHeight: 22,
      paddingTop: s.md,
    },
    cameraCaptureScreen: {
      flex: 1,
      backgroundColor: "#000000",
      padding: s.lg,
      justifyContent: "space-between",
    },
    cameraCaptureHeader: {
      paddingTop: s.xl,
      alignItems: "center",
    },
    cameraCaptureTitle: {
      color: "#FFFFFF",
      fontSize: t.cardTitle,
      fontWeight: "900",
    },
    cameraCaptureText: {
      color: "rgba(255,255,255,0.72)",
      marginTop: s.sm,
      fontWeight: "700",
      textAlign: "center",
    },
    cameraFrame: {
      width: "100%",
      aspectRatio: layout.photoRatio,
      borderRadius: r.xxl,
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
      paddingBottom: s.xxl,
      paddingHorizontal: s.xs,
    },
    cameraCancelButton: {
      minWidth: 86,
      paddingHorizontal: s.lg,
      paddingVertical: s.md,
      borderRadius: r.pill,
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
    scannerOverlay: {
      ...StyleSheet.absoluteFillObject,
      padding: s.xxl,
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: "rgba(0,0,0,0.18)",
    },
    scannerTitle: {
      color: "#FFFFFF",
      fontSize: t.screen,
      fontWeight: "900",
      marginTop: s.xxxl,
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
      borderRadius: r.xl,
      backgroundColor: "rgba(0,0,0,0.08)",
    },
    scannerClose: {
      backgroundColor: "#FFFFFF",
      paddingHorizontal: s.xl,
      paddingVertical: s.md,
      borderRadius: r.pill,
      marginBottom: s.xxl,
    },
    scannerCloseText: {
      color: "#111111",
      fontWeight: "900",
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: s.md,
    },
    profileCard: {
      backgroundColor: theme.surface,
      borderRadius: r.card,
      padding: s.xxl,
      alignItems: "center",
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: s.lg,
    },
    profileName: {
      color: theme.text,
      fontSize: 26,
      fontWeight: "900",
      marginTop: s.md,
    },
    profileHandle: {
      color: theme.muted,
      marginTop: 2,
      fontWeight: "800",
    },
    profileEmail: {
      color: theme.muted,
      marginTop: s.xs,
      marginBottom: s.xl,
      fontSize: t.tiny,
      fontWeight: "700",
    },
    profileActionRow: {
      flexDirection: "row",
      marginTop: s.lg,
      width: "100%",
    },
    statsRow: {
      flexDirection: "row",
      gap: s.sm,
    },
    statBox: {
      backgroundColor: theme.surface2,
      padding: s.md,
      borderRadius: r.lg,
      minWidth: 84,
      alignItems: "center",
      borderWidth: 1,
      borderColor: theme.border,
    },
    statBoxAccent: {
      backgroundColor: theme.accentSoft,
      padding: s.md,
      borderRadius: r.lg,
      minWidth: 84,
      alignItems: "center",
      borderWidth: 1,
      borderColor: theme.border,
    },
    statNumber: {
      color: theme.text,
      fontSize: t.cardTitle,
      fontWeight: "900",
    },
    statLabel: {
      color: theme.muted,
      marginTop: 2,
      fontWeight: "800",
    },
    smallPillButton: {
      backgroundColor: theme.surface2,
      borderRadius: r.pill,
      paddingHorizontal: s.md,
      paddingVertical: s.sm,
      borderWidth: 1,
      borderColor: theme.border,
    },
    smallPillText: {
      color: theme.text,
      fontWeight: "900",
      fontSize: t.tiny,
    },
    crewAddRow: {
      flexDirection: "row",
      gap: s.sm,
      alignItems: "center",
      marginBottom: s.md,
    },
    crewInput: {
      flex: 1,
      minHeight: 44,
      backgroundColor: theme.input,
      color: theme.text,
      borderRadius: r.pill,
      paddingHorizontal: s.lg,
      borderWidth: 1,
      borderColor: theme.border,
    },
    crewButton: {
      backgroundColor: theme.primary,
      paddingHorizontal: s.lg,
      minHeight: 44,
      borderRadius: r.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    crewButtonText: {
      color: "#0B0D0C",
      fontWeight: "900",
    },
    crewListItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: theme.surface2,
      borderRadius: r.lg,
      padding: s.md,
      marginTop: s.sm,
      borderWidth: 1,
      borderColor: theme.border,
      gap: s.md,
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
      borderRadius: r.pill,
      paddingHorizontal: s.md,
      paddingVertical: s.sm,
    },
    removeButtonText: {
      color: theme.accent,
      fontWeight: "900",
      fontSize: t.tiny,
    },
    historyItem: {
      backgroundColor: theme.surface2,
      padding: s.md,
      borderRadius: r.lg,
      marginTop: s.sm,
      borderWidth: 1,
      borderColor: theme.border,
      flexDirection: "row",
      gap: s.md,
      alignItems: "center",
    },
    historyImage: {
      width: 72,
      aspectRatio: layout.photoRatio,
      borderRadius: r.md,
      backgroundColor: theme.surface2,
    },
    historyPlaceholder: {
      width: 72,
      aspectRatio: layout.photoRatio,
      borderRadius: r.md,
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
      marginBottom: s.xs,
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
      marginTop: s.sm,
      fontWeight: "900",
    },
    signOutButton: {
      backgroundColor: theme.surface,
      borderRadius: r.lg,
      padding: s.lg,
      alignItems: "center",
      borderWidth: 1,
      borderColor: theme.border,
      marginBottom: s.xxl,
    },
    signOutText: {
      color: theme.accent,
      fontWeight: "900",
      fontSize: t.body,
    },
    pickerBackdrop: {
      flex: 1,
      backgroundColor: theme.overlay,
      alignItems: "center",
      justifyContent: "center",
      padding: s.xl,
    },
    pickerBackdropPressTarget: {
      ...StyleSheet.absoluteFillObject,
    },
    reactionPicker: {
      backgroundColor: theme.surface,
      borderRadius: r.pill,
      padding: s.sm + 2,
      flexDirection: "row",
      gap: s.sm,
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
      borderRadius: r.card,
      padding: s.xl,
      borderWidth: 1,
      borderColor: theme.border,
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 18,
      elevation: 8,
    },
    customEmojiInput: {
      backgroundColor: theme.input,
      color: theme.text,
      borderRadius: r.lg,
      padding: s.lg,
      borderWidth: 1,
      borderColor: theme.border,
      fontSize: 22,
      marginTop: s.md,
      marginBottom: s.lg,
    },
    editProfileCard: {
      width: "100%",
      maxWidth: 380,
      backgroundColor: theme.surface,
      borderRadius: r.card,
      padding: s.xl,
      borderWidth: 1,
      borderColor: theme.border,
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 18,
      elevation: 8,
    },
    editAvatarRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: s.md,
      marginBottom: s.lg,
    },
    bottomNav: {
      height: 76,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: s.xxl,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      backgroundColor: theme.tab,
    },
    navSideButton: {
      width: 110,
      alignItems: "center",
      paddingVertical: s.md,
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
      left: s.xl,
      right: s.xl,
      bottom: 92,
      backgroundColor: theme.text,
      borderRadius: r.pill,
      paddingVertical: s.md,
      paddingHorizontal: s.lg,
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
