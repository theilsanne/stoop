// Phosphor icons (https://phosphoricons.com), inlined as SVG so only the icons
// used are bundled and they take the surrounding text color (currentColor).

import i_r_house from "@phosphor-icons/core/assets/regular/house.svg?raw";
import i_r_kanban from "@phosphor-icons/core/assets/regular/kanban.svg?raw";
import i_r_sliders_horizontal from "@phosphor-icons/core/assets/regular/sliders-horizontal.svg?raw";
import i_r_scales from "@phosphor-icons/core/assets/regular/scales.svg?raw";
import i_r_gear from "@phosphor-icons/core/assets/regular/gear.svg?raw";
import i_r_train_simple from "@phosphor-icons/core/assets/regular/train-simple.svg?raw";
import i_r_warning from "@phosphor-icons/core/assets/regular/warning.svg?raw";
import i_r_info from "@phosphor-icons/core/assets/regular/info.svg?raw";
import i_r_thumbs_up from "@phosphor-icons/core/assets/regular/thumbs-up.svg?raw";
import i_r_question from "@phosphor-icons/core/assets/regular/question.svg?raw";
import i_r_thumbs_down from "@phosphor-icons/core/assets/regular/thumbs-down.svg?raw";
import i_r_list from "@phosphor-icons/core/assets/regular/list.svg?raw";
import i_r_map_trifold from "@phosphor-icons/core/assets/regular/map-trifold.svg?raw";
import i_r_x from "@phosphor-icons/core/assets/regular/x.svg?raw";
import i_r_arrow_square_out from "@phosphor-icons/core/assets/regular/arrow-square-out.svg?raw";
import i_r_buildings from "@phosphor-icons/core/assets/regular/buildings.svg?raw";
import i_r_chart_line from "@phosphor-icons/core/assets/regular/chart-line.svg?raw";
import i_r_trash from "@phosphor-icons/core/assets/regular/trash.svg?raw";
import i_r_plus from "@phosphor-icons/core/assets/regular/plus.svg?raw";
import i_r_caret_left from "@phosphor-icons/core/assets/regular/caret-left.svg?raw";
import i_r_caret_right from "@phosphor-icons/core/assets/regular/caret-right.svg?raw";
import i_r_dots_six_vertical from "@phosphor-icons/core/assets/regular/dots-six-vertical.svg?raw";
import i_r_map_pin from "@phosphor-icons/core/assets/regular/map-pin.svg?raw";
import i_r_user from "@phosphor-icons/core/assets/regular/user.svg?raw";
import i_r_users from "@phosphor-icons/core/assets/regular/users.svg?raw";
import i_r_chat_circle from "@phosphor-icons/core/assets/regular/chat-circle.svg?raw";
import i_r_arrows_clockwise from "@phosphor-icons/core/assets/regular/arrows-clockwise.svg?raw";
import i_r_check from "@phosphor-icons/core/assets/regular/check.svg?raw";
import i_r_bed from "@phosphor-icons/core/assets/regular/bed.svg?raw";
import i_r_bathtub from "@phosphor-icons/core/assets/regular/bathtub.svg?raw";
import i_r_calendar_blank from "@phosphor-icons/core/assets/regular/calendar-blank.svg?raw";
import i_r_sparkle from "@phosphor-icons/core/assets/regular/sparkle.svg?raw";
import i_r_envelope_simple from "@phosphor-icons/core/assets/regular/envelope-simple.svg?raw";
import i_f_house from "@phosphor-icons/core/assets/fill/house-fill.svg?raw";
import i_f_kanban from "@phosphor-icons/core/assets/fill/kanban-fill.svg?raw";
import i_f_sliders_horizontal from "@phosphor-icons/core/assets/fill/sliders-horizontal-fill.svg?raw";
import i_f_scales from "@phosphor-icons/core/assets/fill/scales-fill.svg?raw";
import i_f_thumbs_up from "@phosphor-icons/core/assets/fill/thumbs-up-fill.svg?raw";
import i_f_question from "@phosphor-icons/core/assets/fill/question-fill.svg?raw";
import i_f_thumbs_down from "@phosphor-icons/core/assets/fill/thumbs-down-fill.svg?raw";

const REGULAR = {
  "house": i_r_house,
  "kanban": i_r_kanban,
  "sliders-horizontal": i_r_sliders_horizontal,
  "scales": i_r_scales,
  "gear": i_r_gear,
  "train-simple": i_r_train_simple,
  "warning": i_r_warning,
  "info": i_r_info,
  "thumbs-up": i_r_thumbs_up,
  "question": i_r_question,
  "thumbs-down": i_r_thumbs_down,
  "list": i_r_list,
  "map-trifold": i_r_map_trifold,
  "x": i_r_x,
  "arrow-square-out": i_r_arrow_square_out,
  "buildings": i_r_buildings,
  "chart-line": i_r_chart_line,
  "trash": i_r_trash,
  "plus": i_r_plus,
  "caret-left": i_r_caret_left,
  "caret-right": i_r_caret_right,
  "dots-six-vertical": i_r_dots_six_vertical,
  "map-pin": i_r_map_pin,
  "user": i_r_user,
  "users": i_r_users,
  "chat-circle": i_r_chat_circle,
  "arrows-clockwise": i_r_arrows_clockwise,
  "check": i_r_check,
  "bed": i_r_bed,
  "bathtub": i_r_bathtub,
  "calendar-blank": i_r_calendar_blank,
  "sparkle": i_r_sparkle,
  "envelope-simple": i_r_envelope_simple,
} as const;
const FILL: Partial<Record<IconName, string>> = {
  "house": i_f_house,
  "kanban": i_f_kanban,
  "sliders-horizontal": i_f_sliders_horizontal,
  "scales": i_f_scales,
  "thumbs-up": i_f_thumbs_up,
  "question": i_f_question,
  "thumbs-down": i_f_thumbs_down,
};

export type IconName = keyof typeof REGULAR;

/** <svg> markup for an icon. Decorative by default (aria-hidden); pass a label when it stands alone. */
export function icon(name: IconName, opts: { fill?: boolean; size?: number; label?: string; cls?: string } = {}) {
  const raw = (opts.fill && FILL[name]) || REGULAR[name];
  const size = opts.size ?? 18;
  const a11y = opts.label ? `role="img" aria-label="${opts.label.replace(/"/g, "&quot;")}"` : 'aria-hidden="true" focusable="false"';
  return raw.replace("<svg ", `<svg class="ic${opts.cls ? " " + opts.cls : ""}" width="${size}" height="${size}" ${a11y} `);
}
