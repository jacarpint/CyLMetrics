'use client';

import dynamic from 'next/dynamic';
import type { GeoDataset } from '@/lib/types';

const LeafletMap = dynamic(() => import('@/components/quality/leaflet-map'), { ssr: false });

export default function LeafletMapWrapper({ datasets }: { datasets: GeoDataset[] }) {
  return <LeafletMap datasets={datasets} />;
}
