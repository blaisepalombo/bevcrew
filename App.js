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
  const longPressUsedRef = useRef(false);
  const photoCameraRef = useRef(null);
  const toastTimerRef = useRef(null);

  const [activeTab, setActiveTab] = useState("Feed");
  const [posts, setPosts] = useState([]);
  const [commentDrafts, setCommentDrafts] = useState({});
  const [loading, setLoading] = useState(true);
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

  const myPosts = posts.filter((post) => post.user === "Blaise");
  const streak = myPosts.length;
  const steps = ["Photo", "Scan", "Post"];
  const categories = ["Energy", "Soda", "Coffee", "Water", "Other"];

  useEffect(() => {
    loadPosts();

    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function toggleTheme() {
    setThemeMode(themeMode === "dark" ? "light" : "dark");
  }

  function showToast(message) {
    setToastMessage(message);

    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);

    toastTimerRef.current = setTimeout(() => {
      setToastMessage("");
    }, 2200);
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

  async function loadPosts() {
    setLoading(true);

    const { data: postRows, error: postError } = await supabase
      .from("posts")
      .select("*")
      .order("created_at", { ascending: false });

    if (postError) {
      setLoading(false);
      Alert.alert("Supabase error", postError.message);
      return;
    }

    const postIds = postRows.map((post) => post.id);
    let reactionRows = [];
    let commentRows = [];

    if (postIds.length > 0) {
      const { data: reactionsData } = await supabase
        .from("reactions")
        .select("post_id, emoji")
        .in("post_id", postIds);

      const { data: commentsData } = await supabase
        .from("comments")
        .select("id, post_id, user_name, text, created_at")
        .in("post_id", postIds)
        .order("created_at", { ascending: true });

      reactionRows = reactionsData || [];
      commentRows = commentsData || [];
    }

    const builtPosts = postRows.map((row) => {
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
    setLoading(false);
  }

  async function uploadImageToSupabase(uri) {
    const fileExt = uri.split(".").pop()?.split("?")[0] || "jpg";
    const contentType =
      fileExt.toLowerCase() === "png" ? "image/png" : "image/jpeg";
    const fileName = `bev-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.${fileExt}`;

    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });

    const { error: uploadError } = await supabase.storage
      .from("bev-photos")
      .upload(fileName, decode(base64), {
        contentType,
        upsert: false,
      });

    if (uploadError) throw uploadError;

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
      const response = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${code}.json`
      );
      const data = await response.json();

      if (data.status === 1 && data.product) {
        const product = data.product;
        const foundBrand = product.brands
          ? product.brands.split(",")[0].trim()
          : "";
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
    if (!isStepReady(2)) {
      Alert.alert("Missing info", "Add the photo, drink details, and rating first.");
      return;
    }

    setSaving(true);

    try {
      const uploadedImageUrl = await uploadImageToSupabase(imageUri);

      const { error } = await supabase.from("posts").insert({
        user_name: "Blaise",
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
    if (!cleanEmoji) return;

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
      .insert({ post_id: postId, emoji: cleanEmoji, user_name: "Blaise" })
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
    if (!text) return;

    const tempComment = { id: `temp-${Date.now()}`, user: "Blaise", text };

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
      user_name: "Blaise",
      text,
    });

    if (error) {
      Alert.alert("Comment failed", error.message);
      await loadPosts();
    }
  }

  function renderStepHeader() {
    return (
      <View style={styles.stepWrap}>
        {steps.map((step, index) => (
          <View key={step} style={styles.stepItem}>
            <View
              style={[
                styles.stepDot,
                index <= postStep && styles.stepDotActive,
              ]}
            >
              <Text
                style={[
                  styles.stepNumber,
                  index <= postStep && styles.stepNumberActive,
                ]}
              >
                {index + 1}
              </Text>
            </View>
            <Text
              style={[
                styles.stepLabel,
                index === postStep && styles.stepLabelActive,
              ]}
            >
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
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={resetPostFlow}
            disabled={saving}
          >
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
        <View style={styles.heroCard}>
          <View style={styles.heroTextWrap}>
            <Text style={styles.heroTitle}>Crew Feed</Text>
            <Text style={styles.heroText}>Today’s drinks from the crew.</Text>
          </View>

          <TouchableOpacity
            style={styles.heroButton}
            onPress={() => setActiveTab("Post")}
          >
            <Text style={styles.heroButtonText}>Post</Text>
          </TouchableOpacity>
        </View>

        {posts.map((post) => {
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

                <TouchableOpacity
                  style={styles.commentButton}
                  onPress={() => addComment(post.id)}
                >
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
            barcodeScannerSettings={{
              barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"],
            }}
          />

          <View style={styles.scannerOverlay}>
            <Text style={styles.scannerTitle}>Scan barcode</Text>
            <Text style={styles.scannerText}>Center the barcode in the box.</Text>
            <View style={styles.scanBox} />
            <TouchableOpacity
              style={styles.scannerClose}
              onPress={() => setScannerOpen(false)}
            >
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
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
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
                  <Text style={styles.photoStatus}>
                    {imageUri ? "Photo ready" : "No photo yet"}
                  </Text>
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
                    <Text
                      style={[
                        styles.chipText,
                        category === item && styles.chipTextActive,
                      ]}
                    >
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
                {imageUri ? (
                  <Image source={{ uri: imageUri }} style={styles.reviewThumbnail} />
                ) : null}

                <View style={styles.reviewTextWrap}>
                  <Text style={styles.reviewBrand}>{brand || "Brand"}</Text>
                  <Text style={styles.reviewFlavor}>{flavor || "Flavor"}</Text>
                  <Text style={styles.reviewCategory}>{category}</Text>
                </View>
              </View>

              <View style={styles.ratingHeaderRow}>
                <Text style={styles.inputLabel}>Rating</Text>
                <Text style={styles.ratingSelected}>
                  {rating ? `${rating}/10` : "pick one"}
                </Text>
              </View>

              <View style={styles.ratingGrid}>
                {RATINGS.map((num) => (
                  <TouchableOpacity
                    key={num}
                    style={[
                      styles.ratingBubble,
                      rating === num && styles.ratingBubbleActive,
                    ]}
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

  function renderHistory() {
    return (
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.screenTitle}>Bev History</Text>
        <Text style={styles.screenSubtitle}>Your personal can trail.</Text>

        {myPosts.map((post) => (
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
        ))}
      </ScrollView>
    );
  }

  function renderProfile() {
    return (
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.screenTitle}>Profile</Text>
        <Text style={styles.screenSubtitle}>Your bev stats so far.</Text>

        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>B</Text>
          </View>

          <Text style={styles.profileName}>Blaise</Text>
          <Text style={styles.profileHandle}>@blaise</Text>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{myPosts.length}</Text>
              <Text style={styles.statLabel}>bevs</Text>
            </View>

            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{streak}</Text>
              <Text style={styles.statLabel}>streak</Text>
            </View>

            <View style={styles.statBoxAccent}>
              <Text style={styles.statNumber}>3</Text>
              <Text style={styles.statLabel}>badges</Text>
            </View>
          </View>
        </View>
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
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={closeCustomEmojiPicker}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalConfirmButton}
                onPress={addCustomReaction}
              >
                <Text style={styles.modalConfirmText}>React</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
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
              <Text style={styles.subtitle}>daily bevs with friends</Text>
            </View>

            <TouchableOpacity style={styles.themeButton} onPress={toggleTheme}>
              <Text style={styles.themeButtonText}>
                {themeMode === "dark" ? "Light" : "Dark"}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {activeTab === "Feed" && renderFeed()}
        {activeTab === "Post" && renderPostFlow()}
        {activeTab === "History" && renderHistory()}
        {activeTab === "Profile" && renderProfile()}

        {!scannerOpen && !customCameraOpen ? (
          <View style={styles.tabs}>
            {["Feed", "Post", "History", "Profile"].map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, activeTab === tab && styles.activeTab]}
                onPress={() => setActiveTab(tab)}
              >
                <Text
                  style={[
                    styles.tabText,
                    activeTab === tab && styles.activeTabText,
                  ]}
                >
                  {tab}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {toastMessage ? (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>{toastMessage}</Text>
          </View>
        ) : null}

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
    historyItem: {
      backgroundColor: theme.surface,
      padding: 12,
      borderRadius: 24,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: theme.border,
      flexDirection: "row",
      gap: 12,
      alignItems: "center",
    },
    historyImage: {
      width: 86,
      aspectRatio: 4 / 5,
      borderRadius: 18,
      backgroundColor: theme.surface2,
    },
    historyPlaceholder: {
      width: 86,
      aspectRatio: 4 / 5,
      borderRadius: 18,
      backgroundColor: theme.surface2,
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
    profileCard: {
      backgroundColor: theme.surface,
      borderRadius: 30,
      padding: 22,
      alignItems: "center",
      borderWidth: 1,
      borderColor: theme.border,
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
      marginBottom: 22,
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
    tabs: {
      flexDirection: "row",
      padding: 10,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      backgroundColor: theme.tab,
    },
    tab: {
      flex: 1,
      paddingVertical: 11,
      borderRadius: 16,
      alignItems: "center",
    },
    activeTab: {
      backgroundColor: theme.primary,
    },
    tabText: {
      color: theme.muted,
      fontWeight: "900",
      fontSize: 12,
    },
    activeTabText: {
      color: "#0B0D0C",
    },
    toast: {
      position: "absolute",
      left: 20,
      right: 20,
      bottom: 84,
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
