import { Leaf, Bus, Landmark, Building2, HeartPulse, GraduationCap, Palette, Users, Layers, type LucideIcon } from 'lucide-react';
import type { Category } from '@/lib/types';

/**
 * Categorías reales del catálogo, mapeadas desde los temas de datos.gob.es
 * (ver THEME_TO_CATEGORY en src/lib/rdf-catalog.ts).
 */
export const categoryIcons: Record<Category, LucideIcon> = {
  'Medio Ambiente': Leaf,
  'Transporte': Bus,
  'Economía': Landmark,
  'Servicios Públicos': Building2,
  'Salud': HeartPulse,
  'Educación': GraduationCap,
  'Cultura': Palette,
  'Demografía': Users,
  'Otros': Layers,
};

export const ALL_CATEGORIES: Category[] = Object.keys(categoryIcons) as Category[];
