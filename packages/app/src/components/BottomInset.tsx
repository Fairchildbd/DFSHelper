import { createContext, useContext } from 'react';
import { View } from 'react-native';

const BottomInsetContext = createContext(0);

export const BottomInsetProvider = BottomInsetContext.Provider;

export function useBottomInset(): number {
  return useContext(BottomInsetContext);
}

export function BottomSpacer({ extra = 0 }: { extra?: number }) {
  const inset = useBottomInset();
  return <View style={{ height: inset + extra }} />;
}
