import {describe,it,expect,vi} from 'vitest';
import {SimpleChange} from '@angular/core';
import {SearchSelectComponent} from './search-select.component';

describe('searchable select',()=>{
 it('keeps the selected label when filtering excludes it and restores it on cancel',()=>{
  const c=new SearchSelectComponent();c.value='kia';c.options=[{id:'kia',name:'Kia'}];c.ngOnChanges({value:new SimpleChange('',c.value,true)});
  c.show();c.search('missing');c.options=[];c.ngOnChanges({options:new SimpleChange([],[],false)});
  expect(c.text).toBe('missing');c.close();expect(c.text).toBe('Kia');expect(c.value).toBe('kia');
 });
 it('does not clear dependents when the same item is selected again',()=>{
  const c=new SearchSelectComponent();c.value='kia';const emit=vi.spyOn(c.valueChange,'emit');
  c.choose('kia','Kia');expect(emit).not.toHaveBeenCalled();c.clear();expect(emit).toHaveBeenCalledWith('');
 });
 it('coalesces scroll requests while a page is pending',()=>{
  const c=new SearchSelectComponent();c.hasMore=true;const emit=vi.spyOn(c.loadMore,'emit');c.more();c.more();expect(emit).toHaveBeenCalledTimes(1);
  c.options=[{id:'new',name:'New'}];c.ngOnChanges({options:new SimpleChange([],c.options,false)});c.more();expect(emit).toHaveBeenCalledTimes(2);
 });
});
