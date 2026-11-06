// MON-02 Nacharbeit: Art eines Rigs. Das Voxelwerk setzt im Rig die ausdrückliche Eigenschaft "art" (z. B. "vierbeiner" im Rig schottbrecher, siehe
// Voxelwerk AUTHORING.md); alle Rigs ohne "art" (also human) gelten als Menschen-Rigs und werden streng geprüft (Anker handR, handL, back, Standardposen,
// höchstens 16 Teile). Keine Heuristik über Gelenknamen: ein Menschen-Rig, dem das Gelenk hips fehlt, soll auffallen und nicht durchrutschen.
export const RIG_ARTEN_OHNE_MENSCH = ['vierbeiner'];
export function istMenschenRig(rig) { return !(rig && RIG_ARTEN_OHNE_MENSCH.includes(rig.art)); }
