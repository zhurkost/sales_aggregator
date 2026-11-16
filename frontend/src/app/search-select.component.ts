import {Component,ElementRef,EventEmitter,Input,OnChanges,Output,SimpleChanges,ViewChild} from '@angular/core';

/** Presentation only: the owner loads choices and stores the selected ID. */
@Component({selector:'app-search-select',standalone:true,templateUrl:'./search-select.component.html',styleUrl:'./search-select.component.css'})
export class SearchSelectComponent implements OnChanges {
 @Input() controlId='';
 @Input() label='';
 @Input() value='';
 @Input() options:readonly {id:string;name:string}[]=[];
 @Input() disabled=false;
 @Input() loading=false;
 @Input() hasMore=false;
 @Output() valueChange=new EventEmitter<string>();
 @Output() queryChange=new EventEmitter<string>();
 @Output() loadMore=new EventEmitter<void>();
 @ViewChild('menu') menu?:ElementRef<HTMLElement>;
 open=false;text='';active=-1;
 private selectedName='';private selectedId='';private pageRequested=false;
 ngOnChanges(changes:SimpleChanges){
  if(this.value!==this.selectedId){this.selectedId=this.value;this.selectedName='';}
  const selected=this.options.find(o=>o.id===this.value);if(selected)this.selectedName=selected.name;
  if(changes['value']||!this.open)this.text=this.selectedName;
  if(changes['options']){this.pageRequested=false;this.active=-1;}
  if(changes['loading']&&!this.loading)this.pageRequested=false;
  if(this.disabled)this.close();
 }
 show(){if(this.disabled||this.open)return;this.open=true;this.active=-1;this.queryChange.emit('');}
 search(value:string){this.text=value;this.open=true;this.active=-1;this.pageRequested=false;this.queryChange.emit(value);}
 close(){this.open=false;this.active=-1;this.text=this.selectedName;}
 choose(id:string,name:string){this.selectedId=id;this.selectedName=name;this.text=name;this.open=false;this.active=-1;if(id!==this.value)this.valueChange.emit(id);}
 clear(){this.choose('','');}
 more(){if(this.hasMore&&!this.loading&&!this.pageRequested){this.pageRequested=true;this.loadMore.emit();}}
 scroll(event:Event){const e=event.target as HTMLElement;if(e.scrollTop+e.clientHeight>=e.scrollHeight-40)this.more();}
 key(event:KeyboardEvent){
  if(event.key==='Escape'){if(this.open){event.preventDefault();event.stopPropagation();this.close();}return;}
  if(event.key==='Tab'){this.close();return;}
  if(event.key==='Enter'&&this.open){event.preventDefault();if(!this.loading&&this.active>=0){if(this.active===0)this.clear();else {const o=this.options[this.active-1];if(o)this.choose(o.id,o.name);}}return;}
  if(!['ArrowDown','ArrowUp'].includes(event.key))return;
  event.preventDefault();if(!this.open)this.show();
  if(this.loading)return;
  this.active=Math.max(0,Math.min(this.options.length,this.active+(event.key==='ArrowDown'?1:-1)));
  const item=this.menu?.nativeElement.children.item(this.active) as HTMLElement|undefined;
  item?.scrollIntoView({block:'nearest'});
  if(this.active===this.options.length)this.more();
 }
}
