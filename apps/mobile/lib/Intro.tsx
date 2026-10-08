import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '@/lib/AppText';
import { T } from './theme';

let played = false; // une seule fois par ouverture de l'application, pas à chaque retour au premier plan

/**
 * Ouverture animée : le logo apparaît en douceur sur le fond vert de l'écran de démarrage (même couleur, donc sans à-coup),
 * le nom et la devise montent, un liseré or se remplit, puis l'écran s'efface vers l'application.
 */
export function Intro() {
  const [done, setDone] = useState(played);
  const logo = useRef(new Animated.Value(0)).current;
  const text = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const out = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (played) return;
    Animated.sequence([
      Animated.parallel([
        Animated.timing(logo, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
        Animated.sequence([Animated.delay(250), Animated.timing(text, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false })]),
        Animated.timing(bar, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
      Animated.delay(150),
      Animated.timing(out, { toValue: 0, duration: 400, easing: Easing.in(Easing.quad), useNativeDriver: false }),
    ]).start(() => { played = true; setDone(true); });
  }, [logo, text, bar, out]);

  if (done) return null;
  return (
    <Animated.View pointerEvents="auto" style={[StyleSheet.absoluteFill, { opacity: out, zIndex: 999 }]}>
      <LinearGradient colors={['#123e30', '#0a2c24']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.fill}>
        <Animated.View style={{ opacity: logo, transform: [{ scale: logo.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }] }}>
          <Image source={require('../assets/splash-logo.png')} style={s.logo} resizeMode="contain" />
        </Animated.View>
        <Animated.View style={{ opacity: text, alignItems: 'center', transform: [{ translateY: text.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
          <Text style={s.name}>JJD Consult</Text>
          <Text style={s.tag}>Votre équipe. Vos chantiers. Tout au même endroit.</Text>
        </Animated.View>
        <View style={s.track}>
          <Animated.View style={[s.fillBar, { width: bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, paddingHorizontal: 32 },
  logo: { width: 150, height: 180 },
  name: { color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  tag: { color: 'rgba(255,255,255,0.72)', fontSize: 14, marginTop: 6, textAlign: 'center' },
  track: { position: 'absolute', bottom: 70, width: 120, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
  fillBar: { height: 3, backgroundColor: T.gold, borderRadius: 2 },
});
