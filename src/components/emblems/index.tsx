import type { ComponentType } from 'react';
import { useActiveSkin } from '../../lib/activeSkin';
import { useEmblemData } from './useEmblemData';
import type { EmblemProps } from './types';
import Tree from './Tree';
import Paper from './Paper';
import Grimoire from './Grimoire';
import Pop from './Pop';
import Arcade from './Arcade';
import Sumi from './Sumi';
import Bauhaus from './Bauhaus';
import Riso from './Riso';
import Blueprint from './Blueprint';
import Swiss from './Swiss';
import Collage from './Collage';
import Rings from './Rings';
import Cyberpunk from './Cyberpunk';
import './emblems.css';

const EMBLEMS: Record<string, ComponentType<EmblemProps>> = {
  canopy: Tree, paper: Paper, grimoire: Grimoire, pop: Pop, arcade: Arcade, sumi: Sumi, bauhaus: Bauhaus,
  riso: Riso, blueprint: Blueprint, swiss: Swiss, collage: Collage, rings: Rings, cyberpunk: Cyberpunk,
};

/** The Today hero's signature art. Each skin owns its emblem; the data is the user's real progress. */
export default function HeroEmblem() {
  const skin = useActiveSkin();
  const data = useEmblemData();
  const Emblem = EMBLEMS[skin] ?? Tree;
  return <div className="hero-tree" data-emblem={skin}><Emblem data={data} /></div>;
}
