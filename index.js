import { StyleSheet, View } from "react-native";
import { registerRootComponent } from "expo";

import App from "./App";
import OnboardingOverlay from "./OnboardingOverlay";

function Root() {
  return (
    <View style={styles.root}>
      <App />
      <OnboardingOverlay />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

// registerRootComponent calls AppRegistry.registerComponent('main', () => Root);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately.
registerRootComponent(Root);
