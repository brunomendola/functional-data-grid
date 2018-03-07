// @flow

import React from 'react'
import BaseColumn from './BaseColumn'
import ColumnGroup from './ColumnGroup'
import { List, Map, OrderedMap, KeyedSeq } from 'immutable'
import Filter from './Filter'
import Sort from './Sort'
import Header from './Header'
import Row from './Row'
import { ScrollSync, AutoSizer, List as ReactVirtualizedList } from 'react-virtualized'
import Group from "./Group"
import DataGroup from "./DataGroup"
import DataRow from './DataRow'
import Aggregate from './Aggregate'
import debounce from 'debounce'

const debounceTimeout = 250
const defaultInitialColumnWidth = 100

type FunctionalDataGridProps<T, A> = {
  columns: List<BaseColumn | ColumnGroup>,
  initialFilter : List<Filter>,
  initialSort : List<Sort>,
  groups : List<Group<any, T>>,
  data : List<T>,
  additionalStyle : Object,
  aggregatesCalculator: ?((List<T>, any) => A),
  showGroupHeaders: boolean,
  onColumnResize: (Object) => void
}
type FunctionalDataGridState<T> = {
  cachedElements : List<DataRow<T>>,
  sort : List<Sort>,
  filter : List<Filter>,
  columnWidths : Map<string, number>
}

export default class FunctionalDataGrid<T, A: void> extends React.Component<FunctionalDataGridProps<T, A>, FunctionalDataGridState<T>> {

  props: FunctionalDataGridProps<T, A>;
  state : FunctionalDataGridState<T>
  list : ReactVirtualizedList;
  debouncedUpdateElements = debounce((data : List<T>, groups : List<Group<any, T>>, sort : List<Sort>, filter : List<Filter>) => this.updateElements(data, groups, sort, filter), debounceTimeout);

  static defaultProps = {
    initialFilter : List(),
    initialSort : List(),
    groups : List(),
    additionalStyle : {},
    aggregatesCalculator: null,
    showGroupHeaders: true,
    onColumnResize: (e: Object) => {}
  }

  constructor(props : FunctionalDataGridProps<T, A>) {
    super(props)
    this.state = {
      cachedElements : List(),
      sort : this.props.initialSort,
      filter : this.props.initialFilter,
      columnWidths : this.getInitialColumnWidths(props.columns)
    }
  }

  getInitialColumnWidths = (columns : List<BaseColumn | ColumnGroup>) => columns.groupBy(c => c.id).map(v => v.get(0).width != null ? v.get(0).width : defaultInitialColumnWidth)

  componentWillMount = () => {
    this.updateElements(this.props.data, this.props.groups, this.state.sort, this.state.filter)
  }

  componentWillUpdate = (newProps: any) => {
    if (newProps.data !== this.props.data)
      this.debouncedUpdateElements(newProps.data, newProps.groups, this.state.sort, this.state.filter)
  }

  render = () => {
    let style = {display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box'}
    return <div style={{...style, ...this.props.additionalStyle}}>
      <ScrollSync>
        {({clientHeight, clientWidth, onScroll, scrollHeight, scrollLeft, scrollTop, scrollWidth}) => (
          <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
            <Header columns={this.props.columns} columnWidths={this.state.columnWidths} scrollLeft={scrollLeft} onScroll={onScroll} sort={this.props.initialSort} onUpdateSort={this.updateSortState} onUpdateFilter={this.updateFilterState} onColumnResize={this.resizeColumn} />
            <div style={{flexGrow: 1}}>
              <AutoSizer>
                {({height, width}) => (
                    <ReactVirtualizedList
                      rowCount={this.getTotalCount()}
                      height={height}
                      width={width}
                      rowHeight={26}
                      rowRenderer={this.rowRenderer(scrollLeft, onScroll)}
                      ref={(list) => { this.list = list }}
                      style={{backgroundColor: '#fff'}}>
                    </ReactVirtualizedList>
                )}
              </AutoSizer>
            </div>
          </div>
        )}
      </ScrollSync>
    </div>
  }

  rowRenderer = (scrollLeft : number, onScroll : Function) => (param: { key: number, index: number, style: Object }) => {
    let element = this.getElement(param.index)
    return <Row key={param.index} style={param.style} columns={this.flatColumns(this.props.columns)} columnWidths={this.state.columnWidths} element={element} onScroll={onScroll} scrollLeft={scrollLeft} rowIndex={param.index} />
  }

  updateElements = (data : List<T>, groups : List<Group<any, T>>, sort : List<Sort>, filter : List<Filter>) => {
    this.setState({ cachedElements: this.computeElements(data, groups, sort, filter) })
    if (this.list != null)
      this.list.forceUpdateGrid()
  }

  computeElements = (data : List<T>, groups : List<Group<any, T>>, sort : List<Sort>, filter : List<Filter>) : List<DataRow<any>> =>
    this.filterGroups(
      this.groupData(
        this.sortData(
          this.enrichData(data),
          sort
        ),
        groups
      ),
      filter
    ).flatMap(this.flatGroups)

  flatGroups = (e: List<DataRow<T> | DataGroup<any, any, A>>) => e instanceof DataGroup ? e.flatten(this.props.showGroupHeaders) : List([e])

  sortData = (data : List<DataRow<T>>, sort : List<Sort>): List<DataRow<T>> => sort.reverse().reduce((data: List<DataRow<T>>, s: Sort) => this.applySort(data, s), data)

  applySort = (data : List<DataRow<T>>, sort : Sort): List<DataRow<T>> => {
    let column = this.getColumnById(sort.columnId)
    return data.sortBy((e: DataRow<T>) => column.valueGetter(e.content), (a, b) => (sort.direction === 'asc' ? 1 : -1) * column.comparator(a, b))
  }

  getColumnById = (columnId : string) => {
    let column = this.flatColumns(this.props.columns).find(c => c.id === columnId)
    if (column == null)
      throw new Error('Invalid column id')
    return column
  }

  enrichData = (data : List<T>) : List<DataRow<T>> => data.map((e, index) => new DataRow(e, 'element', index))

  getElement = (index : number) => this.getElements().get(index)

  getElements = () => this.state.cachedElements

  groupData = <K,> (data : List<DataRow<T>>, groups : List<Group<any, T>>, subGroup: List<[string, any]> = List()): (List<DataRow<T> | DataGroup<any, any, A>>) => groups.isEmpty()
    ? data
    : this.groupDataByGroup(data, groups.first(), subGroup)
          .map((e : DataGroup<K, T, A>) => new DataGroup(e.key, this.groupData(e.data, groups.shift(), subGroup.push([groups.first().title, ((e.key): any)[groups.first().title]])), e.aggregate))

  groupDataByGroup = <K,> (data : (List<DataRow<T>>), group : Group<K, T>, subGroup: List<[string, any]>) : List<DataGroup<K, DataRow<T>, A>> =>
    data.groupBy((e: DataRow<T>) => group.groupingFunction(e.content))
        .map((g: List<T>, key: K) => this.createDataGroup(g, group.id, key, subGroup.push([group.title, key])))
        .toList()
        .sort((dg1, dg2) => group.comparator(dg1.key, dg2.key, dg1.aggregate, dg2.aggregate))

  createDataGroup = <K,> (data: List<T>, groupId: string, key : K, subGroup: List<[string, any]>): DataGroup<any, T, Aggregate<any>> => this.props.aggregatesCalculator == null
    ? new DataGroup(this.getGroupKey(subGroup), data)
    : new DataGroup(this.getGroupKey(subGroup), data, this.createAggregate(this.getGroupKey(subGroup), data.map(e => e.content)))

  createAggregate = <K,> (groupKey: any, data: List<T>) : Aggregate<A> => new Aggregate(groupKey, this.props.aggregatesCalculator(data, groupKey))

  getGroupKey = (subGroup: List<[string, any]>) => {
    let groupKey: Object = {}
    subGroup.forEach((g: [string, any]) => groupKey[g[0]] = g[1])
    return groupKey
  }

  filterGroups = (data : List<DataRow<T> | DataGroup<DataRow<T>>>, filters : List<Filter>) => data
    .filter(e => e instanceof DataGroup || this.applyFiltersToElement(e, filters))    // filter list
    .map(e => e instanceof DataGroup ? this.filterDataGroup(e, filters) : e)          // filter data group
    .filter(e => !(e instanceof DataGroup) || e.data.size > 0)                        // remove empty data groups

  filterDataGroup = <K, G> (dataGroup : DataGroup<K, G, A>, filters : List<Filter>) => {
    return dataGroup.filter((e: any) => this.applyFiltersToElement(e, filters))
  }

  applyFiltersToElement = <T,> (e: DataRow<T>, filters : List<Filter>): boolean => filters.reduce((a: boolean, f: Filter) => a && this.applyFilterToElement(e, f), true)

  applyFilterToElement = <T,> (e : DataRow<T>, filter : Filter) : boolean => filter.matcher(this.getColumnById(filter.columnId).valueGetter(e.content))

  flatColumns = (columns : List<BaseColumn | ColumnGroup>) => columns.flatMap(c => c instanceof ColumnGroup ? c.columns : [c])

  getTotalCount = () => this.getElements().size

  updateSortState = (columnId : string, direction : 'asc' | 'desc' | 'none') => {

    this.setState({
      'sort' : this.updateSort(this.state.sort, columnId, direction)
    }, () => {
      this.debouncedUpdateElements(this.props.data, this.props.groups, this.state.sort, this.state.filter)
    })
  }

  updateFilterState = (columnId : string, matcher : Function) => {

    this.setState({
      'filter' : this.updateFilter(this.state.filter, columnId, matcher)
    }, () => {
      this.debouncedUpdateElements(this.props.data, this.props.groups, this.state.sort, this.state.filter)
    })
  }

  updateFilter = (filter : List<Filter>, columnId : string, matcher : Function) => {
    let index = filter.findIndex(c => c.columnId === columnId)

    return index === -1
      ? filter.push(new Filter(columnId, matcher))
      : filter.set(index, new Filter(columnId, matcher))
  }

  updateSort = (sort : List<Sort>, columnId : string, direction : 'asc' | 'desc' | 'none') => {

    let index = sort.findIndex(c => c.columnId === columnId)

    if (index === -1) {
      if (direction === 'none')
        return sort
      else
        return sort.push(new Sort(columnId, direction))
    }
    else {
      if (direction === 'none')
        return sort.delete(index)
      else
        return sort.set(index, new Sort(columnId, direction))
    }
  }

  resizeColumn = (columnId : string, width : number) => {
    this.setState({
      columnWidths: this.state.columnWidths.set(columnId, width)
    })
    this.props.onColumnResize({id: columnId, width: width})
  }
}
