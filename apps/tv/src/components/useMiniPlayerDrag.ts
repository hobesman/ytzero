import { useMemo, useRef } from "react";
import { Animated, PanResponder } from "react-native";
import { clampOffset, type DragBounds } from "../miniPlayerDrag";

// Where the viewer last left it, kept while the app runs so minimizing again finds it there.
let saved = { x: 0, y: 0 };

/**
 * Lets the viewer drag the mini player out of the way of what it covers. A press
 * that moves only a few points stays a tap on the buttons underneath.
 */
export function useMiniPlayerDrag(bounds: DragBounds) {
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const offset = useRef(new Animated.ValueXY(clampOffset(saved, bounds))).current;
  // A rotation or a taller bar below can leave the saved spot off screen.
  const fitted = clampOffset(saved, bounds);
  if (fitted.x !== saved.x || fitted.y !== saved.y) { saved = fitted; offset.setValue(fitted); }

  const responder = useMemo(() => {
    let start = saved;
    const moved = (dx: number, dy: number) => Math.abs(dx) > 6 || Math.abs(dy) > 6;
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, gesture) => moved(gesture.dx, gesture.dy),
      onPanResponderGrant: () => { start = saved; },
      onPanResponderMove: (_, gesture) => {
        offset.setValue(clampOffset({ x: start.x + gesture.dx, y: start.y + gesture.dy }, boundsRef.current));
      },
      onPanResponderRelease: (_, gesture) => {
        saved = clampOffset({ x: start.x + gesture.dx, y: start.y + gesture.dy }, boundsRef.current);
        offset.setValue(saved);
      },
      onPanResponderTerminate: () => { offset.setValue(saved); },
      onPanResponderTerminationRequest: () => false,
    });
  }, [offset]);

  return { handlers: responder.panHandlers, transform: offset.getTranslateTransform() };
}
