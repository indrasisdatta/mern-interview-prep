// Accessibility checklist(WAI-ARIA APG Accordion pattern): 
// aria-expanded, aria-controls, aria-labelledby, 
// ArrowUp/Down/Home/End, focus management, role="region".

import{ useRef, useState} from "react";

function AccordionPage() {
 const accordionData =[
  { id: 12, heading: "Heading 1", description: "This is description for heading 1"},
  { id: 13, heading: "Heading 2", description: "This is description for heading 2"},
  { id: 14, heading: "Heading 3", description: "This is description for heading 3"},
  { id: 15, heading: "Heading 4", description: "This is description for heading 4"},
 ];

 return(
  <section>
   <h1 className="text-2xl font-semibold tracking-tight">Accordion</h1>
   <p className="mt-2 text-slate-600">
    Build your accordion component here.
   </p>
   <Accordion data={accordionData} defaultExpandedIds={[accordionData?.[0]?.id]} />
  </section>
 )
}

const Accordion =({ data, defaultExpandedIds}) =>{

 // Allow multiple expanded accordions
 // By default, only the first one will be expanded
 const[ expanded, setExpanded] = useState(() =>{
  if(Array.isArray(defaultExpandedIds)) {
   return[...defaultExpandedIds];
  }
  return data?.[0]?.id ?[data?.[0]?.id] :[];
 });

 const buttonRef = useRef([]);

 const handleHeadingClick =(id) =>{
  if(Array.isArray(expanded) && expanded.includes(id)) {
   let filteredExpanded =[...expanded].filter(item => item !== id);
   setExpanded(filteredExpanded);
  } else{
   setExpanded(prev =>([...prev, id]));
  }
 }

 const handleKeyDown =(event, id) =>{
  const lastIndex = data[data.length - 1].id;
  const firstIndex = data[0].id;
  let focusIndex;
  switch(event.key) {
   case 'ArrowUp':
    event.preventDefault();
    focusIndex = id === firstIndex ? lastIndex : id - 1;
    buttonRef.current[focusIndex]?.focus();
    break;
   case 'ArrowDown':
    event.preventDefault();
    focusIndex = id === lastIndex ? firstIndex : id + 1;
    buttonRef.current[focusIndex]?.focus();
    break;
   case 'Home':
    event.preventDefault();
    buttonRef.current[firstIndex]?.focus();
    break;
   case 'End':
    event.preventDefault();
    buttonRef.current[lastIndex]?.focus();
    break;
  }
 }

 if(!data || data.length === 0) {
  return <p>No data found</p>
 }

 return <div className="accordion-container">
   {data.map(({ id, heading, description}) =>{
    const isExpanded= Array.isArray(expanded) && expanded.includes(id);
    return(
     <div key={id} className="accordion-section">
      <h2 className="heading">
       <button
        id={`button-${id}`}
        ref={(node =>{
         buttonRef.current[id] = node;
        })}
        aria-expanded={isExpanded}
        aria-controls={`panel-${id}`}
        onClick={(_) => handleHeadingClick(id)}
        onKeyDown={(e) => handleKeyDown(e, id)}
       >
        {heading}
       </button>
      </h2>
      <div
       id={`panel-${id}`}
       role="region"
       aria-labelledby={`button-${id}`}
       hidden={!isExpanded}
       className={`description ${isExpanded? '': 'collapsed'}`}
      >
       {description}
      </div>
     </div>
   )
   })}
  </div>
}

export default AccordionPage
