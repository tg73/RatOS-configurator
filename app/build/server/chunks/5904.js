"use strict";exports.id=5904,exports.ids=[5904],exports.modules={35904:(e,i,t)=>{t.r(i),t.d(i,{getRequiredPinAliases:()=>getRequiredPinAliases,renderTemplate:()=>renderTemplate});let getRequiredPinAliases=e=>["chamber_lighting_pin"],renderTemplate=e=>`
# ${e.instance.title}
# ${e.instance.description}
[led chamber]
white_pin: ${e.getPrefixedPinFromAlias("chamber_lighting_pin")}
initial_WHITE: 0.5
`}};