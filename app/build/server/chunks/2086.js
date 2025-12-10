"use strict";exports.id=2086,exports.ids=[2086],exports.modules={92086:(e,i,r)=>{r.r(i),r.d(i,{getRequiredPinAliases:()=>getRequiredPinAliases,renderTemplate:()=>renderTemplate});let getRequiredPinAliases=e=>["chamber_filter_4p_fan_pin","chamber_filter_4p_fan_enable_pin"],renderTemplate=e=>`
# ${e.instance.title}
# ${e.instance.description}
[fan_generic filter]
pin: !${e.getPrefixedPinFromAlias("chamber_filter_4p_fan_pin")}
enable_pin: ${e.getPrefixedPinFromAlias("chamber_filter_4p_fan_enable_pin")}
`}};